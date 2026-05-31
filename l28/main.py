import os
import sys
import time
import signal
import numpy as np
from collections import defaultdict

from config import Config
from camera import CameraCapture
from icarl import iCaRL
from model_converter import ModelConverter, TFLiteInference
from monitor import PerformanceMonitor
from grpc_client import FederatedClient
from utils import setup_logging

Config.ensure_dirs()
logger = setup_logging()

class IncrementalLearningSystem:
    def __init__(self, use_tflite=True, enable_federated=True):
        self.icarl = iCaRL(num_classes=Config.INITIAL_CLASSES)
        self.model_converter = ModelConverter()
        self.monitor = PerformanceMonitor()
        self.use_tflite = use_tflite
        self.tflite_inference = None
        self.is_running = False
        
        self.new_samples_buffer = defaultdict(list)
        self.new_samples_threshold = 50
        
        self.federated_client = None
        self.enable_federated = enable_federated
        if enable_federated:
            self.federated_client = FederatedClient()
        
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
    
    def _signal_handler(self, signum, frame):
        logger.info("Received shutdown signal...")
        self.stop()
    
    def start(self):
        logger.info("Starting Incremental Learning System...")
        self.is_running = True
        self.monitor.start_background_reporting()
        
        if self.enable_federated and self.federated_client:
            if self.federated_client.connect():
                self.federated_client.register(
                    self.icarl.num_classes,
                    self.icarl.memory_bank.get_size()
                )
                self.federated_client.start_sync_loop(self.icarl)
                logger.info("Federated learning client started")
            else:
                logger.warning("Failed to connect to federated server, continuing without FL")
        
        try:
            self._run_inference_loop()
        except Exception as e:
            logger.error(f"Error in main loop: {e}", exc_info=True)
        finally:
            self.stop()
    
    def stop(self):
        if not self.is_running:
            return
        
        logger.info("Stopping Incremental Learning System...")
        self.is_running = False
        self.monitor.stop_background_reporting()
        
        if self.federated_client:
            self.federated_client.stop_sync_loop()
            self.federated_client.disconnect()
            logger.info("Federated client stopped")
        
        logger.info("Saving model and memory bank...")
        model_path = self.icarl.save_model(Config.MODEL_SAVE_PATH)
        logger.info(f"Model saved to {model_path}")
        
        logger.info("Converting model to TFLite...")
        convert_result = self.model_converter.h5_to_tflite(model_path)
        logger.info(f"TFLite model saved: {convert_result['tflite_path']}")
        logger.info(f"Compression ratio: {convert_result['compression_ratio']:.2f}x")
        
        logger.info("System stopped.")
    
    def _run_inference_loop(self):
        with CameraCapture() as camera:
            logger.info("Camera initialized.")
            
            frame_count = 0
            while self.is_running:
                start_time = time.time()
                
                original_frame, preprocessed_frame = camera.capture_and_preprocess()
                if original_frame is None:
                    logger.warning("Failed to capture frame")
                    time.sleep(0.1)
                    continue
                
                predicted_class, confidence = self._classify_frame(preprocessed_frame)
                
                inference_time = (time.time() - start_time) * 1000
                self.monitor.record_inference(inference_time, predicted_class)
                
                self._process_new_sample(preprocessed_frame, predicted_class)
                
                frame_count += 1
                if frame_count % 300 == 0:
                    self.monitor.print_metrics()
                    logger.info(f"Memory bank size: {self.icarl.memory_bank.get_size()}")
                    logger.info(f"Number of classes: {self.icarl.num_classes}")
                
                time.sleep(max(0, 1/Config.FPS_TARGET - (time.time() - start_time)))
    
    def _classify_frame(self, preprocessed_frame):
        start_time = time.time()
        
        if self.use_tflite and self.tflite_inference:
            predicted_class, confidence = self.tflite_inference.classify(preprocessed_frame)
        else:
            predicted_class, confidence = self.icarl.classify(preprocessed_frame)
        
        inference_ms = (time.time() - start_time) * 1000
        return predicted_class, confidence
    
    def _process_new_sample(self, image, predicted_class):
        self.new_samples_buffer[predicted_class].append(image)
        
        total_samples = sum(len(samples) for samples in self.new_samples_buffer.values())
        
        if total_samples >= self.new_samples_threshold:
            self._trigger_incremental_learning()
    
    def _trigger_incremental_learning(self):
        logger.info("Triggering incremental learning...")
        
        all_images = []
        all_labels = []
        for label, images in self.new_samples_buffer.items():
            all_images.extend(images)
            all_labels.extend([label] * len(images))
        
        if len(all_images) > 0:
            class_counts = {}
            for l in all_labels:
                class_counts[l] = class_counts.get(l, 0) + 1
            
            memory_images, memory_labels = self.icarl.memory_bank.get_all_samples()
            for l in memory_labels:
                class_counts[int(l)] = class_counts.get(int(l), 0) + 1
            
            logger.info(f"Class distribution before resampling: {class_counts}")
            logger.info(f"Training with {len(all_images)} new samples...")
            self.icarl.train(all_images, all_labels)
            
            if self.icarl.class_weights is not None:
                logger.info(f"Class weights applied: {dict(enumerate(self.icarl.class_weights))}")
            
            model_path = self.icarl.save_model(Config.MODEL_SAVE_PATH)
            convert_result = self.model_converter.h5_to_tflite(model_path)
            self.tflite_inference = TFLiteInference(convert_result['tflite_path'])
            logger.info("Model updated and converted to TFLite")
        
        self.new_samples_buffer.clear()
    
    def add_new_classes(self, new_class_labels):
        logger.info(f"Adding {len(new_class_labels)} new classes: {new_class_labels}")
        self.icarl.increment_classes(new_class_labels)
        logger.info(f"Total classes now: {self.icarl.num_classes}")
    
    def load_existing_model(self):
        model_file = os.path.join(Config.MODEL_SAVE_PATH, 'icarl_model.h5')
        tflite_file = os.path.join(Config.MODEL_SAVE_PATH, 'icarl_model.tflite')
        
        if os.path.exists(model_file):
            logger.info(f"Loading existing model from {model_file}")
            self.icarl.load_model(Config.MODEL_SAVE_PATH)
            
            if os.path.exists(tflite_file) and self.use_tflite:
                self.tflite_inference = TFLiteInference(tflite_file)
                logger.info("TFLite inference engine loaded")
            return True
        return False

def main():
    print("=" * 60)
    print("Edge Incremental Learning System (Raspberry Pi 4B)")
    print("=" * 60)
    
    system = IncrementalLearningSystem(use_tflite=True, enable_federated=True)
    
    if system.load_existing_model():
        logger.info("Resumed from saved state")
    else:
        logger.info("Starting with fresh model")
    
    print("\nCommands:")
    print("  'start' - Start the system")
    print("  'add_classes <list>' - Add new classes (e.g., 'add_classes 10,11,12')")
    print("  'status' - Show system status")
    print("  'fed_status' - Show federated learning status")
    print("  'fed_sync' - Trigger manual federated sync")
    print("  'save' - Save model and memory bank")
    print("  'quit' - Exit the program")
    print()
    
    while True:
        try:
            cmd = input("> ").strip().lower()
            
            if cmd == 'start':
                system.start()
                break
            
            elif cmd.startswith('add_classes'):
                parts = cmd.split()
                if len(parts) > 1:
                    class_labels = [int(x.strip()) for x in parts[1].split(',')]
                    system.add_new_classes(class_labels)
                else:
                    print("Usage: add_classes <comma-separated class IDs>")
            
            elif cmd == 'status':
                system.monitor.print_metrics()
                print(f"Current classes: {system.icarl.num_classes}")
                print(f"Memory bank size: {system.icarl.memory_bank.get_size()}")
            
            elif cmd == 'fed_status':
                if system.federated_client:
                    print(f"  Registered: {system.federated_client.is_registered}")
                    print(f"  Current round: {system.federated_client.current_round}")
                    print(f"  Server: {system.federated_client.server_address}")
                    print(f"  TLS: {Config.TLS_ENABLED}")
                    print(f"  Sync interval: {Config.FED_SYNC_INTERVAL_HOURS}h")
                else:
                    print("  Federated learning not enabled")
            
            elif cmd == 'fed_sync':
                if system.federated_client and system.federated_client.is_registered:
                    print("Triggering manual federated sync...")
                    memory_images, memory_labels = system.icarl.memory_bank.get_all_samples()
                    system.federated_client.upload_model_update(
                        system.icarl.model,
                        num_samples=max(len(memory_labels), 1)
                    )
                    weights_dict, num_classes = system.federated_client.download_global_model()
                    if weights_dict:
                        system.federated_client.apply_global_weights(
                            system.icarl.model, weights_dict
                        )
                        print(f"Global model applied (round {system.federated_client.current_round})")
                    else:
                        print("No global model available yet")
                else:
                    print("Federated client not connected. Use 'start' first.")
            
            elif cmd == 'save':
                path = system.icarl.save_model(Config.MODEL_SAVE_PATH)
                print(f"Model saved to {path}")
            
            elif cmd == 'quit' or cmd == 'exit':
                system.stop()
                print("Goodbye!")
                break
            
            else:
                print(f"Unknown command: {cmd}")
        
        except KeyboardInterrupt:
            print("\nUse 'quit' to exit properly")
        except Exception as e:
            logger.error(f"Command error: {e}")

if __name__ == "__main__":
    main()
