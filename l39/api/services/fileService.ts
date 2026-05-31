import * as fs from 'fs';
import * as path from 'path';
import { FileInfo, FileListResponse } from '../../shared/types';

function readDirectory(dirPath: string): FileInfo[] {
  if (!fs.existsSync(dirPath)) return [];
  
  const files = fs.readdirSync(dirPath);
  const result: FileInfo[] = [];
  
  for (const file of files) {
    if (file.endsWith('.meta.json') || file.endsWith('_values.bin') || file.endsWith('_formation.bin')) {
      continue;
    }
    
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isFile()) {
      const id = file.replace(/\.(segy|json|bin)$/, '').replace(/_meta$/, '');
      let metaData: any = null;
      
      if (file.endsWith('.segy')) {
        const metaPath = path.join(dirPath, `${id}_meta.json`);
        if (fs.existsSync(metaPath)) {
          metaData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        }
      } else if (file.endsWith('.json')) {
        metaData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } else {
        const metaPath = path.join(dirPath, `${id}_meta.json`);
        if (fs.existsSync(metaPath)) {
          metaData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        }
      }
      
      result.push({
        id,
        name: metaData?.filename || metaData?.name || file,
        size: stat.size,
        createdAt: metaData?.createdAt || stat.birthtime.toISOString()
      });
    }
  }
  
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getFileList(dataDir: string): FileListResponse {
  const segyDir = path.join(dataDir, 'segy');
  const gridDir = path.join(dataDir, 'grid');
  const trajectoryDir = path.join(dataDir, 'trajectory');
  
  return {
    segyFiles: readDirectory(segyDir),
    grids: readDirectory(gridDir),
    trajectories: readDirectory(trajectoryDir)
  };
}

export function deleteFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting file:', error);
    return false;
  }
}

export function ensureDataDirs(dataDir: string): void {
  const dirs = ['segy', 'grid', 'trajectory', 'report'];
  for (const dir of dirs) {
    const fullPath = path.join(dataDir, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}
