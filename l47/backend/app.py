import os
import sys
import io
import base64
import numpy as np
import cv2
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import torch

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from configs import cfg
from inference import FaceReconstructor, ExpressionTransfer
from data import ImagePreprocessor

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

device = 'cuda' if torch.cuda.is_available() else 'cpu'
reconstructor = None
expression_transfer = None
image_preprocessor = ImagePreprocessor()

current_session = {
    'params': None,
    'mesh_data': None,
    'recon_result': None
}


def init_models():
    global reconstructor, expression_transfer
    print("Initializing models...")
    reconstructor = FaceReconstructor(
        checkpoint_path=cfg.INFER.CHECKPOINT_PATH,
        use_simple_encoder=False,
        device=device
    )
    expression_transfer = ExpressionTransfer(
        checkpoint_path=cfg.INFER.CHECKPOINT_PATH,
        use_simple_encoder=False,
        device=device
    )
    print("Models initialized successfully!")


def array_to_base64(arr, is_image=True):
    if is_image:
        if len(arr.shape) == 4:
            arr = arr[0]
        if arr.shape[0] == 3:
            arr = arr.transpose(1, 2, 0)
        arr = np.clip(arr * 255, 0, 255).astype(np.uint8)
        _, buffer = cv2.imencode('.png', cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
    else:
        buffer = arr.tobytes()
    return base64.b64encode(buffer).decode('utf-8')


def base64_to_array(b64_str, shape=None, dtype=np.float32):
    bytes_data = base64.b64decode(b64_str)
    arr = np.frombuffer(bytes_data, dtype=dtype)
    if shape:
        arr = arr.reshape(shape)
    return arr


@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'ok',
        'device': device,
        'models_loaded': reconstructor is not None
    })


@app.route('/api/reconstruct', methods=['POST'])
def reconstruct():
    try:
        if 'image' not in request.files and 'image_base64' not in request.json:
            return jsonify({'error': 'No image provided'}), 400
        
        if 'image' in request.files:
            file = request.files['image']
            file_bytes = np.frombuffer(file.read(), np.uint8)
            img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        else:
            img_data = base64.b64decode(request.json['image_base64'])
            img_bytes = np.frombuffer(img_data, np.uint8)
            img = cv2.imdecode(img_bytes, cv2.IMREAD_COLOR)
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        
        result = reconstructor.reconstruct_from_image(img, save_results=False)
        
        current_session['params'] = result['params']
        current_session['recon_result'] = result
        current_session['mesh_data'] = reconstructor.get_mesh_data(result)
        
        rendered_img = image_preprocessor.tensor_to_image(
            result['rendered_image'][0], 
            denormalize=False
        )
        
        original_img = cv2.resize(img, (rendered_img.shape[1], rendered_img.shape[0]))
        
        landmarks_img = image_preprocessor.draw_landmarks(
            rendered_img,
            result['landmarks'][0].cpu().numpy(),
            color=(0, 255, 0),
            radius=2
        )
        
        return jsonify({
            'success': True,
            'original_image': array_to_base64(original_img),
            'rendered_image': array_to_base64(rendered_img),
            'landmarks_image': array_to_base64(landmarks_img),
            'params': reconstructor.get_flame_parameters(result),
            'mesh': current_session['mesh_data']
        })
    
    except Exception as e:
        print(f"Error in reconstruct: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/mesh', methods=['GET'])
def get_mesh():
    try:
        if current_session['mesh_data'] is None:
            return jsonify({'error': 'No mesh available. Please reconstruct first.'}), 400
        
        return jsonify({
            'success': True,
            'mesh': current_session['mesh_data']
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/render_rotated', methods=['POST'])
def render_rotated():
    try:
        data = request.json
        elev = data.get('elev', 0)
        azim = data.get('azim', 0)
        
        if current_session['params'] is None:
            return jsonify({'error': 'No parameters available. Please reconstruct first.'}), 400
        
        rendered_img = reconstructor.model.render_rotated_view(
            current_session['params'],
            elev=elev,
            azim=azim
        )
        
        return jsonify({
            'success': True,
            'rendered_image': array_to_base64(rendered_img[0].cpu().numpy())
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/apply_expression', methods=['POST'])
def apply_expression():
    try:
        data = request.json
        expr_params = np.array(data['expression'], dtype=np.float32)
        
        if current_session['params'] is None:
            return jsonify({'error': 'No parameters available. Please reconstruct first.'}), 400
        
        result = expression_transfer.transfer_expression(
            current_session['params'],
            expr_params
        )
        
        rendered_img = image_preprocessor.tensor_to_image(
            result['rendered_image'][0], 
            denormalize=False
        )
        
        return jsonify({
            'success': True,
            'rendered_image': array_to_base64(rendered_img),
            'vertices': result['vertices'][0].cpu().numpy().tolist(),
            'faces': result['faces'].cpu().numpy().tolist()
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/transfer_expression_video', methods=['POST'])
def transfer_expression_video():
    try:
        if 'video' not in request.files:
            return jsonify({'error': 'No video provided'}), 400
        
        if current_session['params'] is None:
            return jsonify({'error': 'No parameters available. Please reconstruct first.'}), 400
        
        video_file = request.files['video']
        temp_path = os.path.join(cfg.INFER.RESULT_DIR, 'temp_source_video.mp4')
        video_file.save(temp_path)
        
        expression_data = expression_transfer.extract_expressions_from_video(
            temp_path, 
            target_fps=10
        )
        
        base_params = dict(current_session['params'])
        
        original_img = current_session['recon_result'].get('original_image')
        if original_img is not None:
            base_params['original_image'] = original_img
        
        output_path = expression_transfer.transfer_expression_to_video(
            base_params,
            expression_data,
            fps=10
        )
        
        os.remove(temp_path)
        
        with open(output_path, 'rb') as f:
            video_b64 = base64.b64encode(f.read()).decode('utf-8')
        
        return jsonify({
            'success': True,
            'video': video_b64,
            'num_frames': len(expression_data['expressions'])
        })
    
    except Exception as e:
        print(f"Error in transfer_expression_video: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/get_presets', methods=['GET'])
def get_presets():
    expr_dim = cfg.FLAME.EXPR_DIM
    
    presets = {
        'neutral': np.zeros(expr_dim).tolist(),
        'smile': np.zeros(expr_dim).tolist(),
        'sad': np.zeros(expr_dim).tolist(),
        'surprised': np.zeros(expr_dim).tolist(),
        'angry': np.zeros(expr_dim).tolist(),
        'kiss': np.zeros(expr_dim).tolist()
    }
    
    presets['smile'][0:5] = [2.0, 1.5, 1.0, 0.5, 0.3]
    presets['sad'][0:5] = [-0.5, -1.0, -0.8, -0.3, 0.0]
    presets['surprised'][5:10] = [1.5, 1.5, 1.0, 0.8, 0.5]
    presets['angry'][10:15] = [1.2, 1.0, 0.8, 0.5, 0.3]
    presets['kiss'][15:20] = [0.8, 1.2, 0.6, 0.4, 0.2]
    
    return jsonify({
        'success': True,
        'presets': presets,
        'expr_dim': expr_dim
    })


@app.route('/api/interpolate', methods=['POST'])
def interpolate():
    try:
        data = request.json
        expr1 = np.array(data['expr1'], dtype=np.float32)
        expr2 = np.array(data['expr2'], dtype=np.float32)
        num_frames = data.get('num_frames', 30)
        
        interpolated = expression_transfer.interpolate_expressions(
            expr1, expr2, num_frames
        )
        
        return jsonify({
            'success': True,
            'expressions': interpolated.tolist()
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/params', methods=['GET'])
def get_params():
    try:
        if current_session['params'] is None:
            return jsonify({'error': 'No parameters available. Please reconstruct first.'}), 400
        
        return jsonify({
            'success': True,
            'params': reconstructor.get_flame_parameters(current_session['recon_result'])
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def main():
    init_models()
    
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    print(f"Starting server on http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=debug)


if __name__ == '__main__':
    main()
