const { PythonShell } = require('python-shell');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const PYTHON_PATH = process.env.PYTHON_PATH || 'python';
const PYTHON_SCRIPTS_DIR = path.join(__dirname, '..', '..', 'python');

class PythonBridge {
  constructor() {
    this.options = {
      pythonPath: PYTHON_PATH,
      scriptPath: PYTHON_SCRIPTS_DIR,
      mode: 'json',
      stderrParser: (line) => line,
      pythonOptions: ['-u'],
    };
  }

  async analyzeMidi(filePath) {
    return new Promise((resolve, reject) => {
      const script = 'analyze.py';
      const inputData = JSON.stringify({ file_path: filePath });

      const pyshell = new PythonShell(script, this.options);
      let result = null;
      let errorOutput = [];

      pyshell.send(inputData);

      pyshell.on('message', (message) => {
        if (typeof message === 'object') {
          result = message;
        }
      });

      pyshell.on('stderr', (stderr) => {
        errorOutput.push(stderr);
      });

      pyshell.end((err) => {
        if (err) {
          const errorMsg = errorOutput.length > 0 
            ? errorOutput.join('\n') 
            : `Python script error: ${err.message}`;
          
          try {
            const errorJson = JSON.parse(errorOutput.join('\n'));
            if (errorJson.error) {
              reject(new Error(errorJson.error));
              return;
            }
          } catch (e) {}
          
          reject(new Error(errorMsg));
        } else if (result && result.success) {
          resolve(result);
        } else if (result && result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      });
    });
  }

  async parseMidiOnly(filePath) {
    return new Promise((resolve, reject) => {
      const options = {
        ...this.options,
        args: [filePath],
        mode: 'json',
      };

      PythonShell.run('midi_parser.py', options, (err, results) => {
        if (err) {
          reject(err);
        } else if (results && results.length > 0) {
          resolve(results[results.length - 1]);
        } else {
          resolve(null);
        }
      });
    });
  }
}

module.exports = new PythonBridge();
