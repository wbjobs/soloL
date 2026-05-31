import socket
import time
import json
import os
import base64
from typing import List, Dict, Optional, Tuple, Callable
from dataclasses import dataclass, field
from enum import Enum
import hashlib


class POCGenerationMode(Enum):
    PYTHON = "python"
    RUST = "rust"
    BASH = "bash"
    POWERSHELL = "powershell"


class VerificationStatus(Enum):
    CONFIRMED = "confirmed"
    PARTIAL = "partial"
    NOT_REPRODUCIBLE = "not_reproducible"
    INCONCLUSIVE = "inconclusive"


@dataclass
class CrashAttempt:
    attempt_num: int
    payload: bytes
    response: Optional[bytes]
    error: Optional[str]
    elapsed: float
    did_crash: bool
    crash_signature: Optional[str] = None


@dataclass
class VerificationResult:
    crash_id: str
    original_payload: bytes
    status: VerificationStatus
    attempts: List[CrashAttempt] = field(default_factory=list)
    confirmed_crashes: int = 0
    total_attempts: int = 0
    success_rate: float = 0.0
    minimal_payload: Optional[bytes] = None
    description: str = ""

    def to_dict(self) -> Dict:
        return {
            "crash_id": self.crash_id,
            "original_payload_hash": hashlib.sha256(self.original_payload).hexdigest()[:16],
            "status": self.status.value,
            "confirmed_crashes": self.confirmed_crashes,
            "total_attempts": self.total_attempts,
            "success_rate": round(self.success_rate, 4),
            "has_minimal_payload": self.minimal_payload is not None,
            "minimal_payload_size": len(self.minimal_payload) if self.minimal_payload else 0,
            "description": self.description,
            "attempts": [
                {
                    "attempt_num": a.attempt_num,
                    "response_len": len(a.response) if a.response else 0,
                    "error": a.error,
                    "elapsed": round(a.elapsed, 4),
                    "did_crash": a.did_crash
                }
                for a in self.attempts
            ]
        }


class CrashReplayer:
    def __init__(self, target_host: str, target_port: int,
                 protocol: str = "tcp", timeout: float = 5.0,
                 connection_keepalive: bool = False):
        self.target_host = target_host
        self.target_port = target_port
        self.protocol = protocol.lower()
        self.timeout = timeout
        self.connection_keepalive = connection_keepalive
        self._socket: Optional[socket.socket] = None

    def _connect(self) -> Optional[socket.socket]:
        try:
            if self.protocol == "tcp":
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(self.timeout)
                sock.connect((self.target_host, self.target_port))
                return sock
            else:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.settimeout(self.timeout)
                return sock
        except Exception:
            return None

    def _send_and_receive(self, payload: bytes) -> Tuple[Optional[bytes], float, Optional[str]]:
        start_time = time.time()
        error = None
        response = None

        try:
            sock = self._socket if self._socket and self.connection_keepalive else self._connect()
            if not sock:
                return None, time.time() - start_time, "Connection failed"

            if self.protocol == "tcp":
                sock.sendall(payload)
            else:
                sock.sendto(payload, (self.target_host, self.target_port))

            try:
                response = sock.recv(4096)
            except socket.timeout:
                error = "Timeout"
            except Exception as e:
                error = str(e)

            if not self.connection_keepalive:
                try:
                    sock.close()
                except Exception:
                    pass
                self._socket = None
            else:
                self._socket = sock

        except ConnectionRefusedError:
            error = "Connection refused"
        except ConnectionResetError:
            error = "Connection reset"
        except Exception as e:
            error = str(e)

        return response, time.time() - start_time, error

    def _check_crash(self, response: Optional[bytes],
                     error: Optional[str], elapsed: float) -> Tuple[bool, Optional[str]]:
        if error in ["Connection refused", "Connection reset", "Connection aborted"]:
            return True, "connection_crash"

        if response is not None and len(response) == 0 and not error:
            return True, "empty_response"

        if response is not None and len(response) > 4096:
            return False, None

        return False, None

    def verify_crash(self, payload: bytes,
                     num_attempts: int = 5,
                     delay_between: float = 1.0
                     ) -> VerificationResult:
        crash_id = hashlib.sha256(payload).hexdigest()[:16]
        result = VerificationResult(
            crash_id=crash_id,
            original_payload=payload
        )

        for i in range(num_attempts):
            response, elapsed, error = self._send_and_receive(payload)
            did_crash, signature = self._check_crash(response, error, elapsed)

            attempt = CrashAttempt(
                attempt_num=i + 1,
                payload=payload,
                response=response,
                error=error,
                elapsed=elapsed,
                did_crash=did_crash,
                crash_signature=signature
            )
            result.attempts.append(attempt)

            if did_crash:
                result.confirmed_crashes += 1

            time.sleep(delay_between)

        result.total_attempts = num_attempts
        result.success_rate = result.confirmed_crashes / num_attempts

        if result.success_rate >= 0.9:
            result.status = VerificationStatus.CONFIRMED
            result.description = "Crash reliably reproduced"
        elif result.success_rate >= 0.5:
            result.status = VerificationStatus.PARTIAL
            result.description = "Crash intermittently reproduced"
        elif result.success_rate > 0:
            result.status = VerificationStatus.INCONCLUSIVE
            result.description = "Crash rarely reproduced"
        else:
            result.status = VerificationStatus.NOT_REPRODUCIBLE
            result.description = "Crash could not be reproduced"

        return result

    def verify_sequence(self, payload_sequence: List[bytes],
                        num_attempts: int = 3,
                        delay_between: float = 0.5
                        ) -> VerificationResult:
        combined = b"".join(payload_sequence)
        crash_id = hashlib.sha256(combined).hexdigest()[:16]
        result = VerificationResult(
            crash_id=f"seq_{crash_id}",
            original_payload=combined
        )

        for attempt_idx in range(num_attempts):
            sequence_result = self._run_sequence(payload_sequence, delay_between)

            attempt = CrashAttempt(
                attempt_num=attempt_idx + 1,
                payload=combined,
                response=sequence_result.get("final_response"),
                error=sequence_result.get("error"),
                elapsed=sequence_result.get("total_time", 0),
                did_crash=sequence_result.get("crashed", False),
                crash_signature=sequence_result.get("crash_signature")
            )
            result.attempts.append(attempt)

            if sequence_result.get("crashed"):
                result.confirmed_crashes += 1

        result.total_attempts = num_attempts
        result.success_rate = result.confirmed_crashes / num_attempts

        if result.success_rate >= 0.9:
            result.status = VerificationStatus.CONFIRMED
            result.description = "Sequence crash reliably reproduced"
        elif result.success_rate >= 0.5:
            result.status = VerificationStatus.PARTIAL
            result.description = "Sequence crash intermittently reproduced"
        elif result.success_rate > 0:
            result.status = VerificationStatus.INCONCLUSIVE
            result.description = "Sequence crash rarely reproduced"
        else:
            result.status = VerificationStatus.NOT_REPRODUCIBLE
            result.description = "Sequence crash could not be reproduced"

        return result

    def _run_sequence(self, payload_sequence: List[bytes],
                      delay_between: float) -> Dict:
        start_time = time.time()
        crashed = False
        error = None
        final_response = None
        crash_signature = None

        try:
            sock = self._connect()
            if not sock:
                return {"crashed": False, "error": "Connection failed", "total_time": time.time() - start_time}

            for payload in payload_sequence:
                if self.protocol == "tcp":
                    sock.sendall(payload)
                else:
                    sock.sendto(payload, (self.target_host, self.target_port))

                try:
                    response = sock.recv(4096)
                    final_response = response
                except socket.timeout:
                    pass
                except Exception as e:
                    error = str(e)
                    crashed = True
                    crash_signature = "sequence_crash"
                    break

                time.sleep(delay_between)

            try:
                sock.close()
            except Exception:
                pass

        except Exception as e:
            error = str(e)

        return {
            "crashed": crashed,
            "error": error,
            "final_response": final_response,
            "crash_signature": crash_signature,
            "total_time": time.time() - start_time
        }

    def minimize_payload(self, payload: bytes,
                         max_iterations: int = 50) -> Optional[bytes]:
        minimal = payload

        for i in range(max_iterations):
            modified = False

            for length in range(len(minimal), 0, -1):
                for offset in range(len(minimal) - length + 1):
                    test_payload = minimal[:offset] + minimal[offset + length:]
                    if not test_payload:
                        continue

                    result = self.verify_crash(test_payload, num_attempts=2, delay_between=0.1)
                    if result.confirmed_crashes >= 1:
                        minimal = test_payload
                        modified = True
                        break

                if modified:
                    break

            if not modified:
                break

        return minimal if len(minimal) < len(payload) else payload

    def close(self):
        if self._socket:
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None


class POCGenerator:
    def __init__(self, target_host: str, target_port: int, protocol: str = "tcp"):
        self.target_host = target_host
        self.target_port = target_port
        self.protocol = protocol.lower()

    def generate_poc(self, payload: bytes,
                     mode: POCGenerationMode = POCGenerationMode.PYTHON,
                     description: str = "",
                     include_exploit_metadata: bool = True
                     ) -> str:
        if mode == POCGenerationMode.PYTHON:
            return self._generate_python_poc(payload, description, include_exploit_metadata)
        elif mode == POCGenerationMode.RUST:
            return self._generate_rust_poc(payload, description)
        elif mode == POCGenerationMode.BASH:
            return self._generate_bash_poc(payload, description)
        elif mode == POCGenerationMode.POWERSHELL:
            return self._generate_powershell_poc(payload, description)
        else:
            return self._generate_python_poc(payload, description, include_exploit_metadata)

    def _generate_python_poc(self, payload: bytes,
                              description: str,
                              include_metadata: bool) -> str:
        payload_hex = payload.hex()
        payload_bytes_str = self._bytes_to_python_literal(payload)

        lines = [
            "#!/usr/bin/env python3",
            '"""',
            f"Exploit POC generated by Protocol Reverse Fuzzer",
            f"Target: {self.target_host}:{self.target_port} ({self.protocol.upper()})",
            f"Payload size: {len(payload)} bytes",
        ]

        if description:
            lines.append(f"Description: {description}")

        lines.extend([
            '"""',
            "",
            "import socket",
            "import time",
            "import argparse",
            "",
        ])

        if include_metadata:
            lines.append(f"TARGET_HOST = \"{self.target_host}\"")
            lines.append(f"TARGET_PORT = {self.target_port}")
            lines.append(f"PROTOCOL = \"{self.protocol}\"")
            lines.append("")
            lines.append("PAYLOAD = bytes.fromhex(")
            lines.append(f"    \"{payload_hex}\"")
            lines.append(")")
            lines.append("")

        lines.extend([
            "def exploit(host, port, payload):",
            "    try:",
            f"        if PROTOCOL == \"tcp\":",
            "            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
            "            sock.settimeout(5)",
            "            sock.connect((host, port))",
            "            sock.sendall(payload)",
            "            try:",
            "                response = sock.recv(4096)",
            "                print(f\"[*] Response: {len(response)} bytes\")",
            "            except socket.timeout:",
            "                print(\"[!] Timeout (possible crash)\")",
            "            sock.close()",
            "        else:",
            "            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)",
            "            sock.settimeout(5)",
            "            sock.sendto(payload, (host, port))",
            "            try:",
            "                response, _ = sock.recvfrom(4096)",
            "                print(f\"[*] Response: {len(response)} bytes\")",
            "            except socket.timeout:",
            "                print(\"[!] Timeout (possible crash)\")",
            "            sock.close()",
            "        print(\"[+] Exploit sent successfully\")",
            "        return True",
            "    except ConnectionRefusedError:",
            "        print(\"[!] Connection refused (service may have crashed)\")",
            "        return True",
            "    except ConnectionResetError:",
            "        print(\"[!] Connection reset (CRASH CONFIRMED)\")",
            "        return True",
            "    except Exception as e:",
            "        print(f\"[-] Error: {e}\")",
            "        return False",
            "",
            "",
            "if __name__ == \"__main__\":",
            "    parser = argparse.ArgumentParser(description=\"Exploit POC\")",
            '    parser.add_argument("--host", default=TARGET_HOST, help="Target host")',
            '    parser.add_argument("--port", type=int, default=TARGET_PORT, help="Target port")',
            '    parser.add_argument("--count", type=int, default=1, help="Number of attempts")',
            '    parser.add_argument("--delay", type=float, default=1.0, help="Delay between attempts")',
            "    args = parser.parse_args()",
            "",
            "    print(f\"[*] Target: {args.host}:{args.port} ({PROTOCOL.upper()})\")",
            "    print(f\"[*] Payload: {len(PAYLOAD)} bytes\")",
            "    print()",
            "",
            "    for i in range(args.count):",
            "        print(f\"[*] Attempt {i + 1}/{args.count}\")",
            "        exploit(args.host, args.port, PAYLOAD)",
            "        if i < args.count - 1:",
            "            time.sleep(args.delay)",
        ])

        return "\n".join(lines)

    def _bytes_to_python_literal(self, data: bytes) -> str:
        result = []
        for b in data:
            if 32 <= b < 127 and b not in (34, 39, 92):
                result.append(chr(b))
            else:
                result.append(f"\\x{b:02x}")
        return "".join(result)

    def _generate_rust_poc(self, payload: bytes, description: str) -> str:
        payload_hex = payload.hex()

        lines = [
            "// Exploit POC generated by Protocol Reverse Fuzzer",
            f"// Target: {self.target_host}:{self.target_port} ({self.protocol.upper()})",
            f"// Payload size: {len(payload)} bytes",
        ]

        if description:
            lines.append(f"// Description: {description}")

        lines.extend([
            "",
            "use std::io::{self, Read, Write};",
            "use std::net::{TcpStream, UdpSocket};",
            "use std::time::Duration;",
            "use std::env;",
            "",
            "const TARGET_HOST: &str = \"" + self.target_host + "\";",
            f"const TARGET_PORT: u16 = {self.target_port};",
            "",
            "const PAYLOAD: [u8; " + str(len(payload)) + "] = [",
        ])

        for i in range(0, len(payload), 12):
            chunk = payload[i:i + 12]
            hex_vals = ", ".join(f"0x{b:02x}" for b in chunk)
            lines.append(f"    {hex_vals},")

        lines.extend([
            "];",
            "",
            "fn exploit_tcp(host: &str, port: u16, payload: &[u8]) -> io::Result<bool> {",
            '    let addr = format!("{}:{}", host, port);',
            "    match TcpStream::connect_timeout(&addr.parse().unwrap(), Duration::from_secs(5)) {",
            "        Ok(mut stream) => {",
            "            stream.set_read_timeout(Some(Duration::from_secs(5)))?;",
            "            stream.write_all(payload)?;",
            "            let mut buf = [0u8; 4096];",
            "            match stream.read(&mut buf) {",
            "                Ok(n) => println!(\"[*] Response: {} bytes\", n),",
            "                Err(e) if e.kind() == io::ErrorKind::WouldBlock || ",
            "                          e.kind() == io::ErrorKind::TimedOut => {",
            "                    println!(\"[!] Timeout (possible crash)\");",
            "                }",
            "                Err(e) => return Err(e),",
            "            }",
            "            Ok(false)",
            "        }",
            "        Err(e) => {",
            "            match e.kind() {",
            "                io::ErrorKind::ConnectionRefused => {",
            "                    println!(\"[!] Connection refused (service may have crashed)\");",
            "                    Ok(true)",
            "                }",
            "                io::ErrorKind::ConnectionReset => {",
            "                    println!(\"[!] Connection reset (CRASH CONFIRMED)\");",
            "                    Ok(true)",
            "                }",
            "                _ => Err(e),",
            "            }",
            "        }",
            "    }",
            "}",
            "",
            "fn main() {",
            "    let args: Vec<String> = env::args().collect();",
            "    let host = args.get(1).map(|s| s.as_str()).unwrap_or(TARGET_HOST);",
            "    let port = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(TARGET_PORT);",
            "",
            '    println!(\"[*] Target: {}:{} (TCP)\", host, port);',
            '    println!(\"[*] Payload: {} bytes\", PAYLOAD.len());',
            "    println!();",
            "",
            "    match exploit_tcp(host, port, &PAYLOAD) {",
            "        Ok(crashed) if crashed => println!(\"[+] Crash detected!\"),",
            "        Ok(_) => println!(\"[+] Exploit sent\"),",
            "        Err(e) => println!(\"[-] Error: {}\", e),",
            "    }",
            "}",
        ])

        return "\n".join(lines)

    def _generate_bash_poc(self, payload: bytes, description: str) -> str:
        payload_hex = "".join(f"\\x{b:02x}" for b in payload)

        lines = [
            "#!/bin/bash",
            "# Exploit POC generated by Protocol Reverse Fuzzer",
            f"# Target: {self.target_host}:{self.target_port} ({self.protocol.upper()})",
            f"# Payload size: {len(payload)} bytes",
        ]

        if description:
            lines.append(f"# Description: {description}")

        lines.extend([
            "",
            f'HOST="{self.target_host}"',
            f'PORT={self.target_port}',
            "",
            'PAYLOAD="' + payload_hex + '"',
            "",
            "exploit() {",
            "    echo \"[*] Sending exploit payload...\"",
            f'    if command -v nc &>/dev/null; then',
            '        echo -ne "$PAYLOAD" | nc -w 5 "$HOST" "$PORT" 2>&1',
            "        if [ $? -ne 0 ]; then",
            '            echo "[!] Connection error (possible crash)"',
            "        fi",
            "    elif command -v python3 &>/dev/null; then",
            '        python3 -c "',
            "import socket,sys",
            f"s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)",
            's.settimeout(5)',
            "try:",
            '    s.connect((sys.argv[1], int(sys.argv[2])))',
            f'    s.sendall(bytes.fromhex(\"{payload.hex()}\"))',
            "    s.recv(4096)",
            "except (ConnectionResetError, ConnectionRefusedError):",
            '    print(\"CRASH\")',
            "except Exception as e:",
            '    print(f\"Error: {e}\")',
            's.close()',
            f'" "$HOST" "$PORT"',
            "    else",
            '        echo "[-] Neither nc nor python3 found"',
            "        exit 1",
            "    fi",
            "}",
            "",
            'echo "[*] Target: $HOST:$PORT"',
            'echo "[*] Payload size: ' + str(len(payload)) + ' bytes"',
            "echo",
            "exploit",
        ])

        return "\n".join(lines)

    def _generate_powershell_poc(self, payload: bytes, description: str) -> str:
        payload_b64 = base64.b64encode(payload).decode()

        lines = [
            "# Exploit POC generated by Protocol Reverse Fuzzer",
            f"# Target: {self.target_host}:{self.target_port} ({self.protocol.upper()})",
            f"# Payload size: {len(payload)} bytes",
        ]

        if description:
            lines.append(f"# Description: {description}")

        lines.extend([
            "",
            f'$Host = "{self.target_host}"',
            f'$Port = {self.target_port}',
            f'$PayloadB64 = "{payload_b64}"',
            "",
            "$Payload = [Convert]::FromBase64String($PayloadB64)",
            "",
            "function Invoke-Exploit {",
            "    param(",
            '        [string]$TargetHost,',
            "        [int]$TargetPort,",
            "        [byte[]]$ExploitPayload",
            "    )",
            "",
            "    try {",
            '        Write-Host "[*] Connecting to $TargetHost`:$TargetPort..."',
            "        $Client = New-Object System.Net.Sockets.TcpClient",
            "        $Client.ReceiveTimeout = 5000",
            "        $Client.Connect($TargetHost, $TargetPort)",
            "        $Stream = $Client.GetStream()",
            "",
            '        Write-Host "[*] Sending exploit payload..."',
            "        $Stream.Write($ExploitPayload, 0, $ExploitPayload.Length)",
            "",
            "        $Buffer = New-Object byte[] 4096",
            "        try {",
            "            $Read = $Stream.Read($Buffer, 0, $Buffer.Length)",
            '            Write-Host "[*] Received: $Read bytes"',
            "        } catch {",
            '            Write-Host "[!] Timeout or no response (possible crash)"',
            "        }",
            "",
            "        $Stream.Close()",
            "        $Client.Close()",
            '        Write-Host "[+] Exploit sent successfully"',
            "    } catch [System.Net.Sockets.SocketException] {",
            '        if ($_.Exception.Message -match "refused") {',
            '            Write-Host "[!] Connection refused (service may have crashed)"',
            '        } elseif ($_.Exception.Message -match "reset") {',
            '            Write-Host "[!] Connection reset (CRASH CONFIRMED)"',
            "        } else {",
            '            Write-Host "[!] Socket error: $($_.Exception.Message)"',
            "        }",
            "    } catch {",
            '        Write-Host "[-] Error: $($_.Exception.Message)"',
            "    }",
            "}",
            "",
            'Write-Host "[*] Target: $Host`:$Port"',
            'Write-Host "[*] Payload: $($Payload.Length) bytes"',
            "Write-Host ''",
            "",
            "Invoke-Exploit -TargetHost $Host -TargetPort $Port -ExploitPayload $Payload",
        ])

        return "\n".join(lines)

    def save_poc(self, payload: bytes, output_file: str,
                 mode: POCGenerationMode = POCGenerationMode.PYTHON,
                 description: str = "") -> str:
        poc_content = self.generate_poc(payload, mode, description)
        with open(output_file, 'w') as f:
            f.write(poc_content)
        return output_file

    def generate_sequence_poc(self, payload_sequence: List[bytes],
                               mode: POCGenerationMode = POCGenerationMode.PYTHON,
                               delay_between: float = 0.5) -> str:
        if mode == POCGenerationMode.PYTHON:
            return self._generate_sequence_python(payload_sequence, delay_between)
        else:
            return self._generate_sequence_python(payload_sequence, delay_between)

    def _generate_sequence_python(self, payload_sequence: List[bytes],
                                   delay_between: float) -> str:
        lines = [
            "#!/usr/bin/env python3",
            '"""',
            "Sequence exploit POC generated by Protocol Reverse Fuzzer",
            f"Target: {self.target_host}:{self.target_port} ({self.protocol.upper()})",
            f"Sequence length: {len(payload_sequence)} packets",
            f"Delay between: {delay_between}s",
            '"""',
            "",
            "import socket",
            "import time",
            "",
            f"TARGET_HOST = \"{self.target_host}\"",
            f"TARGET_PORT = {self.target_port}",
            "",
            "PAYLOAD_SEQUENCE = [",
        ]

        for i, payload in enumerate(payload_sequence):
            lines.append(f"    # Packet {i + 1} ({len(payload)} bytes)")
            lines.append(f"    bytes.fromhex(\"{payload.hex()}\"),")

        lines.extend([
            "]",
            "",
            "def exploit_sequence(host, port, sequence, delay=0.5):",
            "    sock = None",
            "    try:",
            f"        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
            "        sock.settimeout(5)",
            "        sock.connect((host, port))",
            "",
            "        for i, payload in enumerate(sequence):",
            f"            print(f\"[*] Sending packet {{i + 1}}/{{len(sequence)}}\")",
            "            sock.sendall(payload)",
            "",
            "            try:",
            "                response = sock.recv(4096)",
            f"                print(f\"  -> Response: {{len(response)}} bytes\")",
            "            except socket.timeout:",
            "                print(\"  -> No response\")",
            "",
            "            if i < len(sequence) - 1:",
            "                time.sleep(delay)",
            "",
            "        sock.close()",
            "        print(\"[+] Sequence completed\")",
            "        return True",
            "    except ConnectionRefusedError:",
            "        print(\"[!] Connection refused (service may have crashed)\")",
            "        return True",
            "    except ConnectionResetError:",
            "        print(\"[!] Connection reset (CRASH CONFIRMED)\")",
            "        return True",
            "    except Exception as e:",
            f"        print(f\"[-] Error: {{e}}\")",
            "        return False",
            "    finally:",
            "        if sock:",
            "            try:",
            "                sock.close()",
            "            except Exception:",
            "                pass",
            "",
            "",
            "if __name__ == \"__main__\":",
            "    exploit_sequence(TARGET_HOST, TARGET_PORT, PAYLOAD_SEQUENCE, " + str(delay_between) + ")",
        ])

        return "\n".join(lines)
