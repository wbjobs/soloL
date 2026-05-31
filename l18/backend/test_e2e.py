import requests
import json
import os

BASE_URL = "http://localhost:5000/api"

def login():
    response = requests.post(f"{BASE_URL}/auth/login", json={
        "email": "admin@example.com",
        "password": "admin123"
    })
    if response.status_code == 200:
        token = response.json()["access_token"]
        print(f"[OK] Login successful")
        return token
    else:
        print(f"[FAIL] Login failed: {response.status_code} {response.text}")
        return None

def create_project(token, name="Test Project"):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(f"{BASE_URL}/projects", json={
        "name": name,
        "description": "E2E test project"
    }, headers=headers)
    if response.status_code == 201:
        project_id = response.json()["id"]
        print(f"[OK] Project created: {project_id}")
        return project_id
    else:
        print(f"[FAIL] Create project failed: {response.status_code} {response.text}")
        return None

def upload_point_cloud(token, project_id, filepath):
    headers = {"Authorization": f"Bearer {token}"}
    filename = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        files = {"file": (filename, f, "application/octet-stream")}
        data = {"projectId": project_id, "name": filename}
        response = requests.post(f"{BASE_URL}/point-clouds/upload", 
                               headers=headers, files=files, data=data)
    if response.status_code == 201:
        pc_id = response.json()["id"]
        print(f"[OK] Point cloud uploaded: {pc_id}")
        return pc_id
    else:
        print(f"[FAIL] Upload failed: {response.status_code} {response.text}")
        return None

def get_point_cloud(token, pc_id):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/point-clouds/{pc_id}", headers=headers)
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Got point cloud: {data['name']} ({data['totalPoints']} points)")
        return data
    else:
        print(f"[FAIL] Get point cloud failed: {response.status_code} {response.text}")
        return None

def get_lod_level(token, pc_id, level=0):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/point-clouds/{pc_id}/lod/{level}", headers=headers)
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Got LOD level {level}: {len(data['points'])} points")
        return data
    else:
        print(f"[FAIL] Get LOD failed: {response.status_code} {response.text}")
        return None

def update_labels(token, pc_id, point_indices, label_id):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.put(f"{BASE_URL}/point-clouds/{pc_id}/labels", 
                           headers=headers, json={
                               "updates": [{
                                   "pointIndices": point_indices,
                                   "labelId": label_id
                               }]
                           })
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Labels updated: {data['changes_count']} changes, history_id={data['history_id']}")
        return data
    else:
        print(f"[FAIL] Update labels failed: {response.status_code} {response.text}")
        return None

def get_labels(token, pc_id, start=0, end=100):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/point-clouds/{pc_id}/labels?start={start}&end={end}", headers=headers)
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Got labels: {len(data['labels'])} labels retrieved")
        labeled = sum(1 for l in data['labels'] if l != 0)
        print(f"     Labeled points: {labeled}/{len(data['labels'])}")
        return data
    else:
        print(f"[FAIL] Get labels failed: {response.status_code} {response.text}")
        return None

def predict_labels(token, pc_id, point_indices):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.post(f"{BASE_URL}/inference/predict", 
                           headers=headers, json={
                               "pointCloudId": pc_id,
                               "pointIndices": point_indices
                           })
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Prediction complete: {len(data['predictions'])} predictions")
        print(f"     Processing time: {data['processingTime']:.2f}ms")
        return data
    else:
        print(f"[FAIL] Prediction failed: {response.status_code} {response.text}")
        return None

def get_history(token, pc_id):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/point-clouds/{pc_id}/history", headers=headers)
    if response.status_code == 200:
        data = response.json()
        print(f"[OK] Got history: {len(data)} entries")
        return data
    else:
        print(f"[FAIL] Get history failed: {response.status_code} {response.text}")
        return None

def export_point_cloud(token, pc_id, format="semantickitti"):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(f"{BASE_URL}/point-clouds/{pc_id}/export?format={format}", headers=headers)
    if response.status_code == 200:
        print(f"[OK] Export successful: {len(response.content)} bytes")
        return response.content
    else:
        print(f"[FAIL] Export failed: {response.status_code} {response.text}")
        return None

def main():
    print("=" * 60)
    print("Starting End-to-End API Tests")
    print("=" * 60)
    
    test_file = "e:/soloL/l18/backend/test_data/test_cloud_10k.ply"
    if not os.path.exists(test_file):
        print(f"[FAIL] Test file not found: {test_file}")
        return
    
    token = login()
    if not token:
        return
    
    project_id = create_project(token, "E2E Test Project")
    if not project_id:
        return
    
    pc_id = upload_point_cloud(token, project_id, test_file)
    if not pc_id:
        return
    
    get_point_cloud(token, pc_id)
    get_lod_level(token, pc_id, 0)
    get_lod_level(token, pc_id, 1)
    get_lod_level(token, pc_id, 2)
    
    test_indices = list(range(0, 100))
    update_labels(token, pc_id, test_indices, 1)
    
    get_labels(token, pc_id, 0, 200)
    
    predict_indices = list(range(200, 500))
    predict_labels(token, pc_id, predict_indices)
    
    get_history(token, pc_id)
    
    export_point_cloud(token, pc_id, "semantickitti")
    export_point_cloud(token, pc_id, "ply")
    
    print("\n" + "=" * 60)
    print("All E2E tests completed!")
    print("=" * 60)

if __name__ == "__main__":
    main()
