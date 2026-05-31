import os
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models, optimizers
from tensorflow.keras.applications import MobileNetV2
from config import Config
from utils import softmax, create_one_hot
from memory_bank import MemoryBank
from sample_selector import SampleSelector
from resampler import DynamicResampler

class iCaRL:
    def __init__(self, num_classes=Config.INITIAL_CLASSES):
        self.num_classes = num_classes
        self.model = self._build_model(num_classes)
        self.old_model = None
        self.memory_bank = MemoryBank()
        self.sample_selector = SampleSelector(method='herding')
        self.resampler = DynamicResampler()
        self.class_weights = None
        self.class_list = list(range(num_classes))
    
    def _build_model(self, num_classes):
        base_model = MobileNetV2(
            input_shape=(*Config.IMAGE_SIZE, 3),
            include_top=False,
            weights='imagenet',
            alpha=0.5
        )
        base_model.trainable = True
        
        model = models.Sequential([
            base_model,
            layers.GlobalAveragePooling2D(),
            layers.Dense(256, activation='relu'),
            layers.Dropout(0.5),
            layers.Dense(num_classes, activation='softmax')
        ])
        
        model.compile(
            optimizer=optimizers.Adam(learning_rate=Config.LEARNING_RATE),
            loss='categorical_crossentropy',
            metrics=['accuracy']
        )
        
        return model
    
    def _weighted_categorical_crossentropy(self, y_true, y_pred):
        base_loss = tf.keras.losses.categorical_crossentropy(y_true, y_pred)
        if self.class_weights is not None:
            weights = tf.constant(self.class_weights, dtype=tf.float32)
            sample_weights = tf.reduce_sum(y_true * weights, axis=-1)
            base_loss = base_loss * sample_weights
        return base_loss
    
    def _distillation_loss(self, y_true, y_pred):
        old_classes = self.old_model.output.shape[1] if self.old_model else 0
        
        if old_classes == 0:
            return self._weighted_categorical_crossentropy(y_true, y_pred)
        
        y_old_true = y_true[:, :old_classes]
        y_old_pred = y_pred[:, :old_classes]
        
        logits_old = tf.math.log(y_old_true + 1e-10) / Config.TEMPERATURE
        logits_pred = tf.math.log(y_old_pred + 1e-10) / Config.TEMPERATURE
        
        dist_loss = tf.keras.losses.KLDivergence()(
            tf.nn.softmax(logits_old),
            tf.nn.softmax(logits_pred)
        )
        
        return dist_loss
    
    def _combined_loss(self, y_true, y_pred):
        old_classes = self.old_model.output.shape[1] if self.old_model else 0
        
        if old_classes == 0:
            return self._weighted_categorical_crossentropy(y_true, y_pred)
        
        distillation_loss = self._distillation_loss(y_true, y_pred)
        
        new_classes_mask = tf.concat([
            tf.zeros(old_classes),
            tf.ones(self.num_classes - old_classes)
        ], axis=0)
        
        y_new_true = y_true * new_classes_mask
        y_new_pred = y_pred * new_classes_mask
        
        classification_loss = self._weighted_categorical_crossentropy(
            y_new_true / (tf.reduce_sum(new_classes_mask) + 1e-10),
            y_new_pred / (tf.reduce_sum(new_classes_mask) + 1e-10)
        )
        
        return Config.DISTILLATION_ALPHA * distillation_loss + \
               (1 - Config.DISTILLATION_ALPHA) * classification_loss
    
    def increment_classes(self, new_classes):
        total_classes = self.num_classes + len(new_classes)
        if total_classes > Config.MAX_CLASSES:
            raise ValueError(f"Cannot exceed {Config.MAX_CLASSES} classes")
        
        self.old_model = models.clone_model(self.model)
        self.old_model.set_weights(self.model.get_weights())
        
        old_weights = self.model.layers[-1].get_weights()[0]
        old_biases = self.model.layers[-1].get_weights()[1]
        
        new_weights = np.random.randn(
            old_weights.shape[0],
            len(new_classes)
        ).astype(np.float32) * 0.01
        new_biases = np.zeros(len(new_classes), dtype=np.float32)
        
        combined_weights = np.concatenate([old_weights, new_weights], axis=1)
        combined_biases = np.concatenate([old_biases, new_biases], axis=0)
        
        self.model.pop()
        self.model.add(layers.Dense(total_classes, activation='softmax'))
        
        self.model.layers[-1].set_weights([combined_weights, combined_biases])
        
        self.model.compile(
            optimizer=optimizers.Adam(learning_rate=Config.LEARNING_RATE * 0.5),
            loss=self._combined_loss,
            metrics=['accuracy']
        )
        
        self.class_list.extend(new_classes)
        self.num_classes = total_classes
    
    def extract_features(self, images):
        feature_extractor = models.Model(
            inputs=self.model.input,
            outputs=self.model.layers[-2].output
        )
        return feature_extractor.predict(np.array(images), verbose=0)
    
    def train(self, new_images, new_labels):
        if len(new_images) == 0:
            return
        
        memory_images, memory_labels = self.memory_bank.get_all_samples()
        
        if len(memory_images) > 0:
            all_images = np.concatenate([np.array(new_images), memory_images], axis=0)
            all_labels = np.concatenate([np.array(new_labels), memory_labels], axis=0)
        else:
            all_images = np.array(new_images)
            all_labels = np.array(new_labels)
        
        self.class_weights = self.resampler.compute_class_weights(
            all_labels, self.num_classes
        )
        
        resampled_images, resampled_labels, _ = self.resampler.resample(
            all_images, all_labels
        )
        
        if self.old_model is not None:
            old_logits = self.old_model.predict(
                np.array(memory_images), verbose=0
            ) if len(memory_images) > 0 else np.array([])
            
            y_train = create_one_hot(resampled_labels, self.num_classes)
            
            if len(memory_images) > 0:
                old_logits_map = {}
                for i in range(len(memory_labels)):
                    old_logits_map[i] = old_logits[i]
                
                memory_label_to_indices = {}
                for i, l in enumerate(memory_labels):
                    if l not in memory_label_to_indices:
                        memory_label_to_indices[l] = []
                    memory_label_to_indices[l].append((i, old_logits[i]))
                
                for idx in range(len(resampled_labels)):
                    label = resampled_labels[idx]
                    if label in memory_label_to_indices and label < self.old_model.output.shape[1]:
                        entries = memory_label_to_indices[label]
                        chosen = entries[idx % len(entries)]
                        old_logit = chosen[1]
                        y_train[idx, :len(old_logit)] = softmax(
                            old_logit, Config.TEMPERATURE
                        )
        else:
            y_train = create_one_hot(resampled_labels, self.num_classes)
        
        self.model.fit(
            resampled_images, y_train,
            batch_size=Config.BATCH_SIZE,
            epochs=Config.EPOCHS,
            verbose=1,
            validation_split=0.1
        )
        
        new_features = self.extract_features(new_images)
        self._update_memory_bank(new_images, new_labels, new_features)
    
    def _update_memory_bank(self, images, labels, features):
        n_per_class = Config.MEMORY_SIZE // max(self.num_classes, 1)
        
        new_unique_labels = np.unique(labels)
        for label in new_unique_labels:
            class_indices = [i for i, l in enumerate(labels) if l == label]
            class_images = [images[i] for i in class_indices]
            class_features = [features[i] for i in class_indices]
            
            selected_idx = self.sample_selector.select_samples(
                class_features,
                min(n_per_class, len(class_images))
            )
            
            selected_images = [class_images[i] for i in selected_idx]
            selected_features = [class_features[i] for i in selected_idx]
            selected_labels = [label] * len(selected_idx)
            
            self.memory_bank.add_samples(selected_images, selected_labels, selected_features)
        
        self.sample_selector.prune_memory_bank(self.memory_bank, n_per_class)
    
    def predict(self, images):
        return self.model.predict(np.array(images), verbose=0)
    
    def classify(self, image):
        predictions = self.predict([image])[0]
        predicted_class = np.argmax(predictions)
        confidence = predictions[predicted_class]
        return predicted_class, confidence
    
    def save_model(self, path):
        model_path = os.path.join(path, 'icarl_model.h5')
        self.model.save(model_path)
        self.memory_bank.save(path)
        return model_path
    
    def load_model(self, path):
        model_path = os.path.join(path, 'icarl_model.h5')
        if os.path.exists(model_path):
            self.model = models.load_model(model_path, compile=False)
            self.num_classes = self.model.output.shape[1]
            self.class_list = list(range(self.num_classes))
        self.memory_bank.load(path)
