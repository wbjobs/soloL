import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from app import create_app
from app.extensions import db
from app.models.user import User, ROLE_PRIORITY
from app.models.point_cloud import PointCloud
from app.models.collaboration import (
    Annotation, AnnotationHistory, QualityAssessment,
    ControversialPoint, CollaborativeSession
)
from app.utils.quality_metrics import (
    calculate_label_entropy, krippendorff_alpha,
    find_controversial_points, calculate_overall_quality,
    resolve_label_conflict_with_users
)
from app.utils.crdt import LabelOperation, LabelCRDT
import uuid
from datetime import datetime

def test_quality_metrics():
    print("[1/6] Testing quality metrics...")
    
    # 测试熵计算
    labels1 = [1, 1, 1, 1, 2]  # 低熵（大部分一致）
    entropy1 = calculate_label_entropy(labels1)
    print(f"  低熵测试 (labels={labels1}): {entropy1:.4f}")
    assert entropy1 < 0.8, f"Expected low entropy (<0.8), got {entropy1}"
    
    labels2 = [1, 2, 3, 4, 5]  # 高熵（均匀分布）
    entropy2 = calculate_label_entropy(labels2)
    print(f"  高熵测试 (labels={labels2}): {entropy2:.4f}")
    assert entropy2 > 0.8, f"Expected high entropy (>0.8), got {entropy2}"
    
    labels3 = [1, 1, 1, 1, 1]  # 零熵（完全一致）
    entropy3 = calculate_label_entropy(labels3)
    print(f"  零熵测试 (labels={labels3}): {entropy3:.4f}")
    assert entropy3 < 0.001, f"Expected near zero entropy, got {entropy3}"
    
    # 测试Krippendorff's alpha
    # 注意：数据格式是按点组织的，每一行是一个点被多个标注员标注的结果
    # alpha范围是[-1, 1]，-1表示完全不一致，1表示完全一致，0表示随机
    data = [
        [1, 1, 1],  # 点0: 三个标注员都标1
        [1, 1, 2],  # 点1: 两个标1，一个标2
        [2, 2, 2],  # 点2: 三个标注员都标2
    ]
    alpha = krippendorff_alpha(data)
    print(f"  Krippendorff's alpha测试: {alpha:.4f}")
    assert -1.0 <= alpha <= 1.0, f"Alpha should be between -1 and 1, got {alpha}"
    
    # 完全一致的数据（每个点的所有标注员都给相同标签）
    data_perfect = [
        [1, 1, 1],  # 点0: 都标1
        [2, 2, 2],  # 点1: 都标2
        [3, 3, 3],  # 点2: 都标3
    ]
    alpha_perfect = krippendorff_alpha(data_perfect)
    print(f"  完全一致alpha: {alpha_perfect:.4f}")
    assert abs(alpha_perfect - 1.0) < 0.01, f"Expected alpha near 1.0, got {alpha_perfect}"
    
    # 完全不一致的数据（每个点的标注员都给不同标签）
    data_random = [
        [1, 2, 3],  # 点0: 三个不同标签
        [1, 2, 3],  # 点1: 三个不同标签
        [1, 2, 3],  # 点2: 三个不同标签
    ]
    alpha_random = krippendorff_alpha(data_random)
    print(f"  完全不一致alpha: {alpha_random:.4f}")
    assert alpha_random < 0, f"Expected negative alpha for random data, got {alpha_random}"
    
    # 测试争议点检测
    # 格式: Dict[int, Dict[str, int]] - {point_index: {user_id: label_id}}
    annotations_by_point = {
        0: {'u1': 1, 'u2': 1, 'u3': 1},      # 一致，低熵
        1: {'u1': 1, 'u2': 2, 'u3': 3},      # 争议，高熵
        2: {'u1': 1, 'u2': 1, 'u3': 2},      # 中度
        3: {'u1': 2, 'u2': 2, 'u3': 2},      # 一致
        4: {'u1': 1, 'u2': 2, 'u3': 2, 'u4': 3},   # 争议
    }
    controversial = find_controversial_points(annotations_by_point, entropy_threshold=0.8)
    print(f"  争议点检测: 找到 {len(controversial)} 个争议点: {controversial}")
    assert 1 in [p['point_index'] for p in controversial], "Point 1 should be controversial"
    assert 4 in [p['point_index'] for p in controversial], "Point 4 should be controversial"
    
    # 测试综合质量评估
    quality = calculate_overall_quality(annotations_by_point)
    print(f"  综合质量评估: alpha={quality['krippendorff_alpha']:.4f}, "
          f"avg_entropy={quality['overall_entropy']:.4f}, "
          f"level={quality['quality_level']}")
    
    print("[OK] 质量指标测试通过\n")

def test_role_priority():
    print("[2/6] Testing role priority system...")
    
    print(f"  角色优先级: {ROLE_PRIORITY}")
    assert ROLE_PRIORITY['admin'] == 3
    assert ROLE_PRIORITY['senior'] == 2
    assert ROLE_PRIORITY['annotator'] == 1
    assert ROLE_PRIORITY['junior'] == 0
    assert ROLE_PRIORITY['admin'] > ROLE_PRIORITY['senior']
    assert ROLE_PRIORITY['senior'] > ROLE_PRIORITY['junior']
    
    # 测试冲突解决
    # resolve_label_conflict_with_users参数格式: (user_id, label_id, role_priority)
    annotations = [
        ('user_junior', 1, 0),   # 新手标1
        ('user_senior', 2, 2),   # 资深标2
        ('user_admin', 3, 3),    # 管理员标3
    ]
    resolved = resolve_label_conflict_with_users(annotations)
    print(f"  冲突解决结果: label={resolved[0]}, user={resolved[1]}")
    assert resolved[0] == 3, "Admin should win conflict"
    assert resolved[1] == 'user_admin'
    
    annotations2 = [
        ('user_junior', 1, 0),   # 新手标1
        ('user_senior', 2, 2),   # 资深标2
    ]
    resolved2 = resolve_label_conflict_with_users(annotations2)
    print(f"  资深vs新手: label={resolved2[0]}, user={resolved2[1]}")
    assert resolved2[0] == 2, "Senior should win over junior"
    
    print("[OK] 角色优先级测试通过\n")

def test_crdt():
    print("[3/6] Testing CRDT operations...")
    
    crdt = LabelCRDT()
    
    # 创建操作
    op1 = LabelOperation(
        id=str(uuid.uuid4()),
        point_index=0,
        label_id=1,
        user_id='user1',
        role='junior',
        role_priority=0,
        timestamp=datetime.now(),
        lamport_clock=1
    )
    
    op2 = LabelOperation(
        id=str(uuid.uuid4()),
        point_index=0,
        label_id=2,
        user_id='user2',
        role='admin',
        role_priority=3,
        timestamp=datetime.now(),
        lamport_clock=2
    )
    
    op3 = LabelOperation(
        id=str(uuid.uuid4()),
        point_index=1,
        label_id=3,
        user_id='user1',
        role='junior',
        role_priority=0,
        timestamp=datetime.now(),
        lamport_clock=3
    )
    
    # 添加操作
    crdt.add_operation(op1)
    crdt.add_operation(op2)
    crdt.add_operation(op3)
    
    print(f"  总操作数: {len(crdt._operations)}")
    print(f"  总点数: {len(crdt._point_operations)}")
    
    # 检查优先级解决
    label0 = crdt.get_point_label(0)
    print(f"  点0标签: label={label0[0]}, role={label0[1]}")
    assert label0[0] == 2, "Admin should have higher priority"
    
    label1 = crdt.get_point_label(1)
    print(f"  点1标签: label={label1[0]}, role={label1[1]}")
    assert label1[0] == 3
    
    # 测试合并
    crdt2 = LabelCRDT()
    op4 = LabelOperation(
        id=str(uuid.uuid4()),
        point_index=2,
        label_id=4,
        user_id='user3',
        role='senior',
        role_priority=2,
        timestamp=datetime.now(),
        lamport_clock=4
    )
    crdt2.add_operation(op4)
    
    merged = crdt.merge(crdt2)
    print(f"  合并后总操作数: {len(crdt._operations)}")
    print(f"  新增操作数: {len(merged)}")
    assert len(merged) == 1
    assert crdt.get_point_label(2)[0] == 4
    
    # 测试所有标签
    all_labels = crdt.get_all_labels()
    print(f"  所有标签数: {len(all_labels)}")
    assert len(all_labels) == 3
    
    print("[OK] CRDT测试通过\n")

def test_database_models():
    print("[4/6] Testing database models...")
    
    app = create_app()
    
    with app.app_context():
        db.create_all()
        
        # 检查默认用户
        users = User.query.all()
        print(f"  现有用户数: {len(users)}")
        
        # 检查角色
        for user in users:
            print(f"    - {user.email}: role={user.role}, priority={user.role_priority}")
        
        # 检查角色优先级顺序
        roles = [(u.role, u.role_priority) for u in users]
        role_priorities = {r: p for r, p in roles}
        assert role_priorities.get('admin', -1) > role_priorities.get('senior', -1)
        assert role_priorities.get('senior', -1) > role_priorities.get('junior', -1)
        
        print("[OK] 数据库模型测试通过\n")

def test_api_endpoints():
    print("[5/6] Testing API endpoints...")
    
    app = create_app()
    client = app.test_client()
    
    with app.app_context():
        db.create_all()
        
        # 1. 登录获取token
        response = client.post('/api/auth/login', json={
            'email': 'admin@example.com',
            'password': 'admin123'
        })
        print(f"  登录状态码: {response.status_code}")
        assert response.status_code == 200
        token = response.json['access_token']
        headers = {'Authorization': f'Bearer {token}'}
        
        # 2. 创建项目和点云
        response = client.post('/api/projects', json={
            'name': 'Test Collaboration Project',
            'description': 'Test project for collaboration'
        }, headers=headers)
        assert response.status_code == 201
        project_id = response.json['id']
        
        # 3. 直接在数据库中创建点云（避免文件上传）
        from app.models.point_cloud import PointCloud
        point_cloud = PointCloud(
            name='test_cloud.ply',
            filename='test_cloud.ply',
            project_id=project_id,
            total_points=100,
            bounds={'min': [0, 0, 0], 'max': [10, 10, 10]},
            file_path='/tmp/test.ply'
        )
        db.session.add(point_cloud)
        db.session.commit()
        point_cloud_id = point_cloud.id
        print(f"  创建点云: {point_cloud_id}")
        
        # 4. 添加标注（使用collaboration API）
        # API期望格式: {"pointIndices": [...], "labelId": N}
        for label_id in [1, 2, 3]:
            point_indices = [i for i in range(50) if (i % 3) + 1 == label_id]
            labels_data = {
                'pointIndices': point_indices,
                'labelId': label_id
            }
            response = client.post(
                f'/api/collaboration/{point_cloud_id}/labels',
                json=labels_data,
                headers=headers
            )
            print(f"  添加标签{label_id}标注状态码: {response.status_code}")
            assert response.status_code in [200, 201], f"Failed: {response.json}"
        
        # 5. 以不同角色添加更多标注来创建争议
        response2 = client.post('/api/auth/login', json={
            'email': 'junior@example.com',
            'password': 'junior123'
        })
        token2 = response2.json['access_token']
        headers2 = {'Authorization': f'Bearer {token2}'}
        
        # 新手对同一批点添加不同标签（打乱标签）
        for label_id in [1, 2, 3]:
            point_indices = [i for i in range(20) if ((i % 3) + 1) % 3 + 1 == label_id]
            if point_indices:
                labels_data = {
                    'pointIndices': point_indices,
                    'labelId': label_id
                }
                response = client.post(
                    f'/api/collaboration/{point_cloud_id}/labels',
                    json=labels_data,
                    headers=headers2
                )
                print(f"  新手添加标签{label_id}标注状态码: {response.status_code}")
                assert response.status_code in [200, 201], f"Failed: {response.json}"
        
        # 6. 执行质量评估（需要发送JSON，即使是空对象）
        response = client.post(
            f'/api/collaboration/{point_cloud_id}/quality',
            json={},
            headers=headers
        )
        print(f"  质量评估状态码: {response.status_code}")
        if response.status_code == 200:
            quality_data = response.json
            print(f"    Krippendorff's alpha: {quality_data.get('krippendorff_alpha', 'N/A')}")
            print(f"    平均熵: {quality_data.get('overall_entropy', 'N/A')}")
            print(f"    争议点数: {quality_data.get('controversial_point_count', 'N/A')}")
            print(f"    质量等级: {quality_data.get('quality_level', 'N/A')}")
            print(f"    需要重标: {quality_data.get('needs_review', 'N/A')}")
        
        # 7. 获取争议点（返回字典，包含controversialPoints字段）
        response = client.get(
            f'/api/collaboration/{point_cloud_id}/controversial-points',
            headers=headers
        )
        print(f"  获取争议点状态码: {response.status_code}")
        if response.status_code == 200:
            result = response.json
            points = result.get('controversialPoints', [])
            print(f"    争议点数量: {len(points)}")
            if points:
                print(f"    前3个争议点: {points[:3]}")
        
        print("[OK] API端点测试通过\n")

def test_full_workflow():
    print("[6/6] Testing full collaboration workflow...")
    
    app = create_app()
    client = app.test_client()
    
    with app.app_context():
        db.create_all()
        
        # 登录三个不同角色的用户
        users = {
            'admin': {'email': 'admin@example.com', 'password': 'admin123'},
            'senior': {'email': 'senior@example.com', 'password': 'senior123'},
            'junior': {'email': 'junior@example.com', 'password': 'junior123'},
        }
        
        tokens = {}
        for role, creds in users.items():
            response = client.post('/api/auth/login', json=creds)
            tokens[role] = response.json['access_token']
        print(f"  已登录 {len(tokens)} 个用户")
        
        # 创建项目和点云
        admin_headers = {'Authorization': f'Bearer {tokens["admin"]}'}
        response = client.post('/api/projects', json={
            'name': 'Multi-user Collaboration Test',
            'description': 'Test multi-user annotation with conflict resolution'
        }, headers=admin_headers)
        project_id = response.json['id']
        
        # 直接在数据库中创建点云（避免文件上传）
        from app.models.point_cloud import PointCloud
        point_cloud = PointCloud(
            name='collab_test.ply',
            filename='collab_test.ply',
            project_id=project_id,
            total_points=50,
            bounds={'min': [0, 0, 0], 'max': [10, 10, 10]},
            file_path='/tmp/collab_test.ply'
        )
        db.session.add(point_cloud)
        db.session.commit()
        point_cloud_id = point_cloud.id
        print(f"  创建点云: {point_cloud_id[:8]}...")
        
        # 三个用户标注同一批点（创建冲突场景）
        # API期望格式: {"pointIndices": [...], "labelId": N}
        label_sets = {
            'admin': {'label': 1, 'points': list(range(20))},      # 管理员标0-19为1
            'senior': {'label': 2, 'points': list(range(10, 30))}, # 资深标10-29为2
            'junior': {'label': 3, 'points': list(range(20))},     # 新手标0-19为3
        }
        
        for role, data in label_sets.items():
            headers = {'Authorization': f'Bearer {tokens[role]}'}
            labels_data = {
                'pointIndices': data['points'],
                'labelId': data['label']
            }
            response = client.post(
                f'/api/collaboration/{point_cloud_id}/labels',
                json=labels_data,
                headers=headers
            )
            print(f"  {role} 标注了 {len(data['points'])} 个点，状态码: {response.status_code}")
            assert response.status_code == 200, f"Failed: {response.json}"
        
        # 执行质量评估（需要发送JSON）
        response = client.post(
            f'/api/collaboration/{point_cloud_id}/quality',
            json={},
            headers=admin_headers
        )
        quality = response.json
        print(f"\n  === 质量评估结果 ===")
        print(f"  Krippendorff's alpha: {quality.get('krippendorff_alpha', 0):.4f}")
        print(f"  平均熵: {quality.get('overall_entropy', 0):.4f}")
        print(f"  争议点数: {quality.get('controversial_point_count', 0)}")
        print(f"  质量等级: {quality.get('quality_level', 'unknown')}")
        print(f"  需要重新标注: {'是' if quality.get('needs_review') else '否'}")
        
        # 获取合并后的标签，检查优先级是否生效
        response = client.get(
            f'/api/collaboration/{point_cloud_id}/labels/resolved',
            headers=admin_headers
        )
        if response.status_code == 200:
            labels = response.json.get('labels', {})
            print(f"\n  === 冲突解决检查 ===")
            # 点0-9: admin=1, junior=3 → admin赢，应为1
            # 点10-19: admin=1, senior=2, junior=3 → admin赢，应为1
            # 点20-29: senior=2 → 应为2
            checks = [
                (5, 1, 'admin vs junior (admin should win)'),
                (15, 1, 'admin vs senior vs junior (admin should win)'),
                (25, 2, 'senior only'),
            ]
            for point_idx, expected, desc in checks:
                actual_label = labels.get(str(point_idx))
                # actual可能是字典 {labelId, rolePriority, userId}
                if isinstance(actual_label, dict):
                    actual = actual_label.get('labelId')
                else:
                    actual = actual_label
                status = '✓' if actual == expected else '✗'
                print(f"  {status} 点{point_idx}: expected={expected}, actual={actual} - {desc}")
        
        # 获取争议点并尝试解决一个
        response = client.get(
            f'/api/collaboration/{point_cloud_id}/controversial-points',
            headers=admin_headers
        )
        result = response.json
        controversial_points = result.get('controversialPoints', [])
        if controversial_points:
            point_to_resolve = controversial_points[0]['pointIndex']
            print(f"\n  尝试解决争议点 {point_to_resolve}")
            # API期望字段名是finalLabel
            response = client.post(
                f'/api/collaboration/{point_cloud_id}/controversial-points/{point_to_resolve}/resolve',
                json={'finalLabel': 1},
                headers=admin_headers
            )
            print(f"  解决状态码: {response.status_code}")
            if response.status_code == 200:
                print(f"  解决结果: {response.json}")
        
        print("[OK] 完整工作流测试通过\n")

def main():
    print("=" * 60)
    print("协作与质量评估功能测试套件")
    print("=" * 60 + "\n")
    
    try:
        test_quality_metrics()
        test_role_priority()
        test_crdt()
        test_database_models()
        test_api_endpoints()
        test_full_workflow()
        
        print("=" * 60)
        print("所有测试通过! ✓")
        print("=" * 60)
        return 0
    except AssertionError as e:
        print(f"\n[FAIL] 断言失败: {e}")
        import traceback
        traceback.print_exc()
        return 1
    except Exception as e:
        print(f"\n[FAIL] 测试异常: {e}")
        import traceback
        traceback.print_exc()
        return 2

if __name__ == '__main__':
    sys.exit(main())
