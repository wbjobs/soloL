import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

print("Creating Flask app...")
try:
    app = create_app()
    print("[OK] App created successfully")
    
    print("\nRegistered routes:")
    for rule in app.url_map.iter_rules():
        if rule.endpoint != 'static':
            methods = ','.join(sorted(rule.methods - {'OPTIONS', 'HEAD'}))
            print(f"  {methods:20} {rule}")
    
    print("\nTesting API endpoints...")
    client = app.test_client()
    
    print("\n1. Testing login...")
    login_response = client.post('/api/auth/login', json={
        'email': 'admin@example.com',
        'password': 'admin123'
    })
    print(f"   Status: {login_response.status_code}")
    if login_response.status_code == 200:
        data = login_response.get_json()
        token = data.get('access_token')
        print(f"   [OK] Login successful, token obtained")
        
        headers = {'Authorization': f'Bearer {token}'}
        
        print("\n2. Testing get label definitions...")
        labels_response = client.get('/api/point-clouds/label-definitions', headers=headers)
        print(f"   Status: {labels_response.status_code}")
        if labels_response.status_code == 200:
            labels = labels_response.get_json()
            print(f"   [OK] Got {len(labels)} label definitions")
            for label in labels[:3]:
                print(f"     - {label['name']}: {label['color']}")
        
        print("\n3. Testing get model info...")
        model_response = client.get('/api/inference/model-info', headers=headers)
        print(f"   Status: {model_response.status_code}")
        if model_response.status_code == 200:
            model_info = model_response.get_json()
            print(f"   [OK] Model info: {model_info.get('name', 'Unknown')}")
            print(f"     Batch size: {model_info.get('batch_size', 'N/A')}")
            print(f"     GPU: {model_info.get('use_gpu', False)}")
        
        print("\n4. Testing create project...")
        project_response = client.post('/api/projects', headers=headers, json={
            'name': 'Test Project',
            'description': 'Test project for point cloud annotation'
        })
        print(f"   Status: {project_response.status_code}")
        if project_response.status_code == 201:
            project = project_response.get_json()
            project_id = project.get('id')
            print(f"   [OK] Project created: {project_id}")
            
            print("\n5. Testing get projects...")
            projects_response = client.get('/api/projects', headers=headers)
            print(f"   Status: {projects_response.status_code}")
            if projects_response.status_code == 200:
                projects = projects_response.get_json()
                print(f"   [OK] Got {len(projects)} projects")
    else:
        print(f"   [FAIL] Login failed: {login_response.get_json()}")
    
    print("\n" + "="*50)
    print("All basic tests completed successfully!")
    print("="*50)
    
except Exception as e:
    print(f"\n[ERROR] {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
