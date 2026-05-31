import os
import subprocess
import sys
from config import Config

def generate_tls_certificates():
    cert_dir = Config.TLS_CERT_DIR
    os.makedirs(cert_dir, exist_ok=True)
    
    ca_key = os.path.join(cert_dir, "ca.key")
    ca_cert = os.path.join(cert_dir, "ca.crt")
    server_key = os.path.join(cert_dir, "server.key")
    server_csr = os.path.join(cert_dir, "server.csr")
    server_cert = os.path.join(cert_dir, "server.crt")
    client_key = os.path.join(cert_dir, "client.key")
    client_csr = os.path.join(cert_dir, "client.csr")
    client_cert = os.path.join(cert_dir, "client.crt")
    server_ext = os.path.join(cert_dir, "server_ext.cnf")
    client_ext = os.path.join(cert_dir, "client_ext.cnf")
    
    with open(server_ext, 'w') as f:
        f.write("basicConstraints = CA:FALSE\n")
        f.write("keyUsage = digitalSignature, keyEncipherment\n")
        f.write("extendedKeyUsage = serverAuth\n")
        f.write("subjectAltName = @alt_names\n\n")
        f.write("[alt_names]\n")
        f.write("DNS.1 = localhost\n")
        f.write("DNS.2 = federated-server\n")
        f.write("IP.1 = 127.0.0.1\n")
        f.write("IP.2 = 0.0.0.0\n")
    
    with open(client_ext, 'w') as f:
        f.write("basicConstraints = CA:FALSE\n")
        f.write("keyUsage = digitalSignature, keyEncipherment\n")
        f.write("extendedKeyUsage = clientAuth\n")
    
    steps = [
        (["openssl", "genrsa", "-out", ca_key, "4096"],
         "Generating CA private key"),
        
        (["openssl", "req", "-new", "-x509", "-days", "365", "-key", ca_key,
          "-out", ca_cert, "-subj", "/C=CN/ST=Beijing/L=Beijing/O=EdgeFed/OU=CA/CN=EdgeFed-CA"],
         "Generating CA certificate"),
        
        (["openssl", "genrsa", "-out", server_key, "2048"],
         "Generating server private key"),
        
        (["openssl", "req", "-new", "-key", server_key, "-out", server_csr,
          "-subj", "/C=CN/ST=Beijing/L=Beijing/O=EdgeFed/OU=Server/CN=federated-server"],
         "Generating server CSR"),
        
        (["openssl", "x509", "-req", "-days", "365", "-in", server_csr,
          "-CA", ca_cert, "-CAkey", ca_key, "-CAcreateserial",
          "-out", server_cert, "-extfile", server_ext],
         "Signing server certificate"),
        
        (["openssl", "genrsa", "-out", client_key, "2048"],
         "Generating client private key"),
        
        (["openssl", "req", "-new", "-key", client_key, "-out", client_csr,
          "-subj", "/C=CN/ST=Beijing/L=Beijing/O=EdgeFed/OU=Client/CN=rpi-client"],
         "Generating client CSR"),
        
        (["openssl", "x509", "-req", "-days", "365", "-in", client_csr,
          "-CA", ca_cert, "-CAkey", ca_key, "-CAcreateserial",
          "-out", client_cert, "-extfile", client_ext],
         "Signing client certificate"),
    ]
    
    for cmd, desc in steps:
        print(f"  {desc}...")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  ERROR: {result.stderr}")
            return False
    
    for f in [server_csr, client_csr]:
        if os.path.exists(f):
            os.remove(f)
    
    print(f"\n  Certificates generated in {cert_dir}/")
    print(f"  CA:         {ca_cert}")
    print(f"  Server:     {server_cert}")
    print(f"  Client:     {client_cert}")
    return True


if __name__ == "__main__":
    print("Generating TLS certificates for federated learning...")
    if generate_tls_certificates():
        print("Done!")
    else:
        print("Certificate generation failed!")
        sys.exit(1)
