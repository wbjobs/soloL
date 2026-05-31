import Minio from 'minio';
import dotenv from 'dotenv';

dotenv.config();

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  useSSL: process.env.MINIO_USE_SSL === 'true',
});

const BUCKETS = ['defect-photos', 'voice-notes', 'models'];

export async function ensureBuckets() {
  for (const bucket of BUCKETS) {
    try {
      const exists = await minioClient.bucketExists(bucket);
      if (!exists) {
        await minioClient.makeBucket(bucket);
        console.log(`Created MinIO bucket: ${bucket}`);
      } else {
        console.log(`MinIO bucket already exists: ${bucket}`);
      }
    } catch (err) {
      console.error(`Error ensuring bucket ${bucket}:`, err.message);
    }
  }
}

export async function uploadFile(bucket, name, buffer, contentType) {
  const metadata = {
    'Content-Type': contentType,
  };
  await minioClient.putObject(bucket, name, buffer, buffer.length, metadata);
  return name;
}

export async function getFileUrl(bucket, name) {
  return await minioClient.presignedGetObject(bucket, name, 24 * 60 * 60);
}

export { minioClient };
