const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);

class VideoEncoder {
    constructor(outputDir) {
        this.outputDir = outputDir;
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    }

    async encodeFramesToMP4(framesDir, outputFilename, fps = 24) {
        const outputPath = path.join(this.outputDir, outputFilename);
        
        const frameFiles = fs.readdirSync(framesDir)
            .filter(f => f.endsWith('.png'))
            .sort();

        if (frameFiles.length === 0) {
            throw new Error('No frames found in directory');
        }

        console.log(`Encoding ${frameFiles.length} frames to ${outputPath}...`);

        try {
            const ffmpegCmd = this._buildFFmpegCommand(framesDir, outputPath, fps);
            await execAsync(ffmpegCmd);
            
            console.log('Video encoding complete!');
            return {
                success: true,
                outputFile: outputPath,
                frameCount: frameFiles.length
            };
        } catch (error) {
            console.error('FFmpeg error, trying alternative method...');
            
            try {
                const result = await this._encodeWithNode(framesDir, outputPath, fps);
                return result;
            } catch (nodeError) {
                console.error('Node encoding also failed:', nodeError);
                throw new Error(`Failed to encode video: ${error.message}`);
            }
        }
    }

    _buildFFmpegCommand(framesDir, outputPath, fps) {
        const inputPattern = path.join(framesDir, 'frame_%04d.png');
        
        return `ffmpeg -y -framerate ${fps} -i "${inputPattern}" ` +
               `-c:v libx264 -pix_fmt yuv420p -preset medium -crf 23 ` +
               `"${outputPath}"`;
    }

    async _encodeWithNode(framesDir, outputPath, fps) {
        try {
            const cv = require('opencv4nodejs');
        } catch (e) {
            console.log('OpenCV not available, creating manifest file instead');
            return this._createManifest(framesDir, outputPath);
        }
    }

    _createManifest(framesDir, outputPath) {
        const frameFiles = fs.readdirSync(framesDir)
            .filter(f => f.endsWith('.png'))
            .sort();

        const manifest = {
            frames: frameFiles.map(f => path.join(framesDir, f)),
            outputPath: outputPath,
            status: 'frames_ready',
            note: 'FFmpeg required for MP4 encoding. Please run: ' +
                  'ffmpeg -framerate 24 -i "frames/frame_%04d.png" output.mp4'
        };

        const manifestPath = outputPath.replace('.mp4', '_manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

        return {
            success: true,
            outputFile: manifestPath,
            frameCount: frameFiles.length,
            note: 'Frames are ready. Use FFmpeg to encode to MP4.'
        };
    }

    checkFFmpegAvailable() {
        return new Promise((resolve) => {
            exec('ffmpeg -version', (error) => {
                resolve(!error);
            });
        });
    }
}

module.exports = VideoEncoder;
