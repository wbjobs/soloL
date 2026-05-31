import sys

print("Checking dependencies...")

try:
    import flask
    print(f"✓ Flask {flask.__version__}")
except Exception as e:
    print(f"✗ Flask: {e}")

try:
    import flask_cors
    print(f"✓ Flask-CORS")
except Exception as e:
    print(f"✗ Flask-CORS: {e}")

try:
    import flask_jwt_extended
    print(f"✓ Flask-JWT-Extended")
except Exception as e:
    print(f"✗ Flask-JWT-Extended: {e}")

try:
    import sqlalchemy
    print(f"✓ SQLAlchemy {sqlalchemy.__version__}")
except Exception as e:
    print(f"✗ SQLAlchemy: {e}")

try:
    import numpy as np
    print(f"✓ NumPy {np.__version__}")
except Exception as e:
    print(f"✗ NumPy: {e}")

try:
    import torch
    print(f"✓ PyTorch {torch.__version__}")
    print(f"  CUDA available: {torch.cuda.is_available()}")
except Exception as e:
    print(f"✗ PyTorch: {e}")

try:
    import torch_scatter
    print(f"✓ torch-scatter")
except Exception as e:
    print(f"✗ torch-scatter: {e}")

try:
    import torch_sparse
    print(f"✓ torch-sparse")
except Exception as e:
    print(f"✗ torch-sparse: {e}")

try:
    from plyfile import PlyData
    print(f"✓ plyfile")
except Exception as e:
    print(f"✗ plyfile: {e}")

print("\nDependency check complete.")
