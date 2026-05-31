import { exec } from 'child_process'

export async function getActiveWindowTitle(): Promise<string> {
  if (process.platform === 'win32') {
    return getWindowsActiveWindow()
  } else if (process.platform === 'darwin') {
    return getMacActiveWindow()
  } else {
    return getLinuxActiveWindow()
  }
}

function getWindowsActiveWindow(): Promise<string> {
  return new Promise((resolve) => {
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")]
          public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        }
      "@
      $hWnd = [Win32]::GetForegroundWindow()
      $text = New-Object System.Text.StringBuilder 256
      [Win32]::GetWindowText($hWnd, $text, 256) | Out-Null
      $text.ToString()
    `

    exec(`powershell -NoProfile -Command "${psScript}"`, (error, stdout) => {
      if (error) {
        resolve('')
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

function getMacActiveWindow(): Promise<string> {
  return new Promise((resolve) => {
    exec(
      'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
      (error, stdout) => {
        if (error) {
          resolve('')
        } else {
          resolve(stdout.trim())
        }
      }
    )
  })
}

function getLinuxActiveWindow(): Promise<string> {
  return new Promise((resolve) => {
    exec('xdotool getactivewindow getwindowname', (error, stdout) => {
      if (error) {
        resolve('')
      } else {
        resolve(stdout.trim())
      }
    })
  })
}
