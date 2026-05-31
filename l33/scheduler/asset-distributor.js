const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AssetDistributor {
  constructor(uploadsDir) {
    this.uploadsDir = uploadsDir;
    this.assetIndex = new Map();
    this.nodeCacheStatus = new Map();
  }

  indexJobAssets(jobId, blendFilePath) {
    const blendDir = path.dirname(blendFilePath);
    const assets = [];

    const textureExts = ['.png', '.jpg', '.jpeg', '.tga', '.bmp', '.exr', '.hdr', '.tif', '.tiff'];
    const meshExts = ['.obj', '.fbx', '.stl', '.dae', '.abc', '.usd', '.usdc', '.usda'];

    this._scanDirectory(blendDir, textureExts, meshExts, assets, jobId);

    assets.forEach(asset => {
      this.assetIndex.set(asset.asset_id, asset);
    });

    console.log(`Indexed ${assets.length} assets for job ${jobId}`);
    return assets;
  }

  _scanDirectory(dir, textureExts, meshExts, assets, jobId) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._scanDirectory(fullPath, textureExts, meshExts, assets, jobId);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        let assetType = null;
        if (textureExts.includes(ext)) assetType = 'texture';
        else if (meshExts.includes(ext)) assetType = 'mesh';

        if (assetType) {
          const stat = fs.statSync(fullPath);
          const assetId = this._computeAssetId(fullPath);
          assets.push({
            asset_id: assetId,
            file_path: fullPath,
            asset_type: assetType,
            file_size: stat.size,
            checksum: this._computeChecksum(fullPath),
            job_id: jobId
          });
        }
      }
    }
  }

  _computeAssetId(filePath) {
    const hash = crypto.createHash('sha256');
    hash.update(filePath);
    try {
      const stat = fs.statSync(filePath);
      hash.update(stat.mtimeMs.toString());
      hash.update(stat.size.toString());
    } catch (e) {}
    return hash.digest('hex').substring(0, 16);
  }

  _computeChecksum(filePath) {
    try {
      const data = fs.readFileSync(filePath);
      return crypto.createHash('md5').update(data).digest('hex');
    } catch (e) {
      return '';
    }
  }

  getAssetById(assetId) {
    return this.assetIndex.get(assetId) || null;
  }

  getAssetsByJob(jobId) {
    return Array.from(this.assetIndex.values())
      .filter(a => a.job_id === jobId);
  }

  getAssetDownloadUrl(assetId) {
    const asset = this.assetIndex.get(assetId);
    if (!asset) return null;
    return `/api/assets/${assetId}/download`;
  }

  updateNodeCacheStatus(nodeId, status) {
    this.nodeCacheStatus.set(nodeId, {
      ...status,
      updated_at: Date.now()
    });
  }

  getNodeCacheStatus(nodeId) {
    return this.nodeCacheStatus.get(nodeId) || null;
  }

  getAllNodeCacheStatus() {
    return Array.from(this.nodeCacheStatus.entries()).map(([nodeId, status]) => ({
      node_id: nodeId,
      ...status
    }));
  }

  distributeAssetsToNode(nodeId, assetIds) {
    const results = [];
    for (const assetId of assetIds) {
      const asset = this.assetIndex.get(assetId);
      if (asset) {
        results.push({
          asset_id: asset.asset_id,
          file_path: asset.file_path,
          asset_type: asset.asset_type,
          file_size: asset.file_size,
          checksum: asset.checksum,
          download_url: this.getAssetDownloadUrl(assetId)
        });
      }
    }
    return results;
  }
}

module.exports = AssetDistributor;
