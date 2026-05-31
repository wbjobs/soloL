import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSrt, SrtBlock } from './srt-parser';

const execFileAsync = promisify(execFile);

export class WhisperRunner {
  async transcribe(
    videoPath: string,
    options?: { language?: string; model?: string },
  ): Promise<SrtBlock[]> {
    const model = options?.model || 'base';
    const language = options?.language || 'auto';

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));

    try {
      const isAvailable = await this.isWhisperAvailable();
      if (!isAvailable) {
        console.warn('Whisper CLI is not installed. Returning empty transcription.');
        return [];
      }

      const args: string[] = [
        videoPath,
        '--model', model,
        '--output_format', 'srt',
        '--output_dir', tmpDir,
      ];

      if (language && language !== 'auto') {
        args.push('--language', language);
      }

      await execFileAsync('whisper', args, { timeout: 600000 });

      const videoBasename = path.basename(videoPath, path.extname(videoPath));
      const srtPath = path.join(tmpDir, `${videoBasename}.srt`);

      if (!fs.existsSync(srtPath)) {
        console.warn(`Whisper output SRT file not found at ${srtPath}`);
        return [];
      }

      const srtContent = fs.readFileSync(srtPath, 'utf-8');
      return parseSrt(srtContent);
    } catch (error) {
      console.warn('Whisper transcription failed:', (error as Error).message);
      return [];
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  private async isWhisperAvailable(): Promise<boolean> {
    try {
      await execFileAsync('whisper', ['--help'], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}
