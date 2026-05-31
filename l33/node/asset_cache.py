import os
import json
import time
import hashlib
import shutil
from collections import OrderedDict
from pathlib import Path


class LRUCache:
    def __init__(self, capacity_mb=51200):
        self.capacity = capacity_mb * 1024 * 1024
        self.current_size = 0
        self.cache = OrderedDict()
        
    def get(self, key):
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        return None
        
    def put(self, key, value, size=0):
        if key in self.cache:
            self.cache.move_to_end(key)
            return
            
        while self.current_size + size > self.capacity and self.cache:
            evicted_key, evicted_value = self.cache.popitem(last=False)
            self.current_size -= evicted_value.get('size', 0)
            
        self.cache[key] = {'value': value, 'size': size}
        self.current_size += size
        
    def remove(self, key):
        if key in self.cache:
            self.current_size -= self.cache[key].get('size', 0)
            del self.cache[key]
            
    def clear(self):
        self.cache.clear()
        self.current_size = 0
        
    def get_usage(self):
        return {
            'total_bytes': self.capacity,
            'used_bytes': self.current_size,
            'usage_percent': (self.current_size / self.capacity * 100) if self.capacity > 0 else 0,
            'item_count': len(self.cache)
        }


class AssetCacheManager:
    def __init__(self, cache_dir=None, max_size_mb=51200):
        self.cache_dir = cache_dir or os.path.join(os.path.dirname(__file__), 'asset_cache')
        self.max_size_mb = max_size_mb
        self.lru = LRUCache(max_size_mb)
        self.manifest_file = os.path.join(self.cache_dir, 'manifest.json')
        self.manifest = {}
        
        os.makedirs(self.cache_dir, exist_ok=True)
        self._load_manifest()
        self._rebuild_lru()
        
    def _load_manifest(self):
        if os.path.exists(self.manifest_file):
            try:
                with open(self.manifest_file, 'r') as f:
                    self.manifest = json.load(f)
            except Exception as e:
                print(f"Failed to load asset manifest: {e}")
                self.manifest = {}
                
    def _save_manifest(self):
        try:
            with open(self.manifest_file, 'w') as f:
                json.dump(self.manifest, f, indent=2)
        except Exception as e:
            print(f"Failed to save asset manifest: {e}")
            
    def _rebuild_lru(self):
        for asset_id, info in self.manifest.items():
            if os.path.exists(info.get('local_path', '')):
                self.lru.put(asset_id, info, info.get('size', 0))
            else:
                del self.manifest[asset_id]
        self._save_manifest()
        
    @staticmethod
    def compute_asset_id(file_path):
        hasher = hashlib.sha256()
        hasher.update(file_path.encode('utf-8'))
        try:
            mtime = os.path.getmtime(file_path)
            hasher.update(str(mtime).encode('utf-8'))
            size = os.path.getsize(file_path)
            hasher.update(str(size).encode('utf-8'))
        except:
            pass
        return hasher.hexdigest()[:16]
        
    def has_asset(self, asset_id):
        if asset_id in self.manifest:
            info = self.manifest[asset_id]
            if os.path.exists(info.get('local_path', '')):
                self.lru.get(asset_id)
                return True
            else:
                del self.manifest[asset_id]
                self._save_manifest()
        return False
        
    def get_asset_path(self, asset_id):
        if self.has_asset(asset_id):
            return self.manifest[asset_id]['local_path']
        return None
        
    def store_asset(self, source_path, asset_id=None, asset_type='texture'):
        if asset_id is None:
            asset_id = self.compute_asset_id(source_path)
            
        if self.has_asset(asset_id):
            return self.get_asset_path(asset_id)
            
        file_size = os.path.getsize(source_path) if os.path.exists(source_path) else 0
        
        ext = os.path.splitext(source_path)[1]
        local_filename = f"{asset_id}{ext}"
        local_path = os.path.join(self.cache_dir, local_filename)
        
        type_dir = os.path.join(self.cache_dir, asset_type)
        os.makedirs(type_dir, exist_ok=True)
        local_path = os.path.join(type_dir, local_filename)
        
        shutil.copy2(source_path, local_path)
        
        info = {
            'asset_id': asset_id,
            'original_path': source_path,
            'local_path': local_path,
            'size': file_size,
            'type': asset_type,
            'cached_at': time.time(),
            'last_access': time.time()
        }
        
        self.manifest[asset_id] = info
        self.lru.put(asset_id, info, file_size)
        self._save_manifest()
        
        return local_path
        
    def store_asset_data(self, asset_id, data, original_path, asset_type='texture'):
        if self.has_asset(asset_id):
            return self.get_asset_path(asset_id)
            
        ext = os.path.splitext(original_path)[1] if original_path else '.bin'
        type_dir = os.path.join(self.cache_dir, asset_type)
        os.makedirs(type_dir, exist_ok=True)
        local_filename = f"{asset_id}{ext}"
        local_path = os.path.join(type_dir, local_filename)
        
        with open(local_path, 'wb') as f:
            f.write(data)
            
        file_size = len(data)
        
        info = {
            'asset_id': asset_id,
            'original_path': original_path,
            'local_path': local_path,
            'size': file_size,
            'type': asset_type,
            'cached_at': time.time(),
            'last_access': time.time()
        }
        
        self.manifest[asset_id] = info
        self.lru.put(asset_id, info, file_size)
        self._save_manifest()
        
        return local_path
        
    def preload_blend_assets(self, blend_file, stub=None):
        asset_list = self._scan_blend_assets(blend_file)
        
        loaded = 0
        skipped = 0
        for asset in asset_list:
            asset_id = self.compute_asset_id(asset['path'])
            if self.has_asset(asset_id):
                skipped += 1
                continue
                
            if os.path.exists(asset['path']):
                self.store_asset(asset['path'], asset_id, asset['type'])
                loaded += 1
                
        print(f"Asset preload: {loaded} loaded, {skipped} cached")
        return {'loaded': loaded, 'skipped': skipped, 'total': len(asset_list)}
        
    def _scan_blend_assets(self, blend_file):
        assets = []
        blend_dir = os.path.dirname(blend_file)
        
        texture_exts = {'.png', '.jpg', '.jpeg', '.tga', '.bmp', '.exr', '.hdr', '.tif', '.tiff'}
        mesh_exts = {'.obj', '.fbx', '.stl', '.dae', '.abc', '.usd', '.usdc', '.usda'}
        
        for root, dirs, files in os.walk(blend_dir):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                fpath = os.path.join(root, f)
                
                if ext in texture_exts:
                    assets.append({'path': fpath, 'type': 'texture'})
                elif ext in mesh_exts:
                    assets.append({'path': fpath, 'type': 'mesh'})
                    
        return assets
        
    def get_cache_stats(self):
        usage = self.lru.get_usage()
        return {
            'cache_dir': self.cache_dir,
            'max_size_mb': self.max_size_mb,
            'used_mb': round(usage['used_bytes'] / 1024 / 1024, 2),
            'usage_percent': round(usage['usage_percent'], 2),
            'item_count': usage['item_count'],
            'textures': sum(1 for v in self.manifest.values() if v.get('type') == 'texture'),
            'meshes': sum(1 for v in self.manifest.values() if v.get('type') == 'mesh')
        }
        
    def cleanup(self):
        self._save_manifest()
        for asset_id, info in list(self.manifest.items()):
            if not os.path.exists(info.get('local_path', '')):
                self.lru.remove(asset_id)
                del self.manifest[asset_id]
        self._save_manifest()
