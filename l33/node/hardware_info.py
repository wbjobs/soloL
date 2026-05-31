import platform
import socket
import psutil

try:
    import wmi
    WMI_AVAILABLE = True
except ImportError:
    WMI_AVAILABLE = False


def get_hardware_info():
    gpus = []
    
    if WMI_AVAILABLE:
        try:
            c = wmi.WMI()
            for gpu in c.Win32_VideoController():
                gpu_info = {
                    'name': gpu.Name or 'Unknown GPU',
                    'memory_total': int(gpu.AdapterRAM) if gpu.AdapterRAM else 0,
                    'memory_free': 0,
                    'compute_capability_major': 0,
                    'compute_capability_minor': 0
                }
                gpus.append(gpu_info)
        except Exception as e:
            print(f"Error getting GPU info: {e}")
    
    if not gpus:
        gpus.append({
            'name': 'Unknown GPU',
            'memory_total': 0,
            'memory_free': 0,
            'compute_capability_major': 0,
            'compute_capability_minor': 0
        })
    
    cpu_cores = psutil.cpu_count(logical=True) or 0
    ram_total = psutil.virtual_memory().total
    os_name = platform.platform()
    node_name = socket.gethostname()
    
    return {
        'gpus': gpus,
        'cpu_cores': cpu_cores,
        'ram_total': ram_total,
        'os': os_name,
        'node_name': node_name
    }


def get_current_load():
    return int(psutil.cpu_percent())


if __name__ == '__main__':
    info = get_hardware_info()
    print("Hardware Info:")
    print(f"  Node: {info['node_name']}")
    print(f"  OS: {info['os']}")
    print(f"  CPU Cores: {info['cpu_cores']}")
    print(f"  RAM: {info['ram_total'] / (1024**3):.2f} GB")
    print(f"  GPUs:")
    for gpu in info['gpus']:
        print(f"    - {gpu['name']}: {gpu['memory_total'] / (1024**3):.2f} GB")
