import os
import tensorflow as tf
import numpy as np
from config import Config

class ModelConverter:
    def __init__(self):
        self.quantization = True
    
    def h5_to_tflite(self, h5_model_path, tflite_output_path=None, optimize=True):
        if tflite_output_path is None:
            tflite_output_path = os.path.join(
                Config.MODEL_SAVE_PATH,
                os.path.splitext(os.path.basename(h5_model_path))[0] + '.tflite'
            )
        
        model = tf.keras.models.load_model(h5_model_path, compile=False)
        
        converter = tf.lite.TFLiteConverter.from_keras_model(model)
        
        if optimize:
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            
            def representative_dataset():
                for _ in range(100):
                    yield [np.random.rand(1, *Config.IMAGE_SIZE, 3).astype(np.float32)]
            
            converter.representative_dataset = representative_dataset
            converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
            converter.inference_input_type = tf.uint8
            converter.inference_output_type = tf.uint8
        
        tflite_model = converter.convert()
        
        with open(tflite_output_path, 'wb') as f:
            f.write(tflite_model)
        
        h5_size = os.path.getsize(h5_model_path) / (1024 * 1024)
        tflite_size = os.path.getsize(tflite_output_path) / (1024 * 1024)
        
        return {
            'tflite_path': tflite_output_path,
            'h5_size_mb': h5_size,
            'tflite_size_mb': tflite_size,
            'compression_ratio': h5_size / tflite_size
        }

class TFLiteInference:
    def __init__(self, tflite_model_path):
        self.interpreter = tf.lite.Interpreter(model_path=tflite_model_path)
        self.interpreter.allocate_tensors()
        
        self.input_details = self.interpreter.get_input_details()
        self.output_details = self.interpreter.get_output_details()
        
        self.input_scale = self.input_details[0]['quantization'][0]
        self.input_zero_point = self.input_details[0]['quantization'][1]
        self.output_scale = self.output_details[0]['quantization'][0]
        self.output_zero_point = self.output_details[0]['quantization'][1]
        
        self.is_quantized = self.input_details[0]['dtype'] == np.uint8
    
    def predict(self, image):
        if len(image.shape) == 3:
            image = np.expand_dims(image, axis=0)
        
        if self.is_quantized:
            image = (image / self.input_scale + self.input_zero_point).astype(np.uint8)
        else:
            image = image.astype(np.float32)
        
        self.interpreter.set_tensor(self.input_details[0]['index'], image)
        self.interpreter.invoke()
        
        output = self.interpreter.get_tensor(self.output_details[0]['index'])
        
        if self.is_quantized:
            output = (output.astype(np.float32) - self.output_zero_point) * self.output_scale
        
        return output
    
    def classify(self, image):
        predictions = self.predict(image)[0]
        predicted_class = np.argmax(predictions)
        confidence = predictions[predicted_class]
        return predicted_class, confidence
    
    def get_input_shape(self):
        return self.input_details[0]['shape']
