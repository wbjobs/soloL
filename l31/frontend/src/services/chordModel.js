import * as tf from '@tensorflow/tfjs'
import { NUM_PITCH_CLASSES, NUM_CHORDS, INDEX_TO_CHORD, notesToChromaMatrix, notesToPitchClassVector } from '../utils/chordUtils'

class ChordPredictionModel {
  constructor() {
    this.model = null
    this.isTrained = false
    this.trainingData = []
    this.trainingLabels = []
    this.sequenceLength = 16
    this.isTraining = false
  }

  buildModel() {
    if (this.model) {
      this.model.dispose()
    }

    this.model = tf.sequential()

    this.model.add(tf.layers.lstm({
      units: 64,
      inputShape: [this.sequenceLength, NUM_PITCH_CLASSES],
      returnSequences: true,
      dropout: 0.2,
      recurrentDropout: 0.2
    }))

    this.model.add(tf.layers.lstm({
      units: 32,
      returnSequences: false,
      dropout: 0.2
    }))

    this.model.add(tf.layers.dense({
      units: 64,
      activation: 'relu'
    }))

    this.model.add(tf.layers.dropout({ rate: 0.3 }))

    this.model.add(tf.layers.dense({
      units: NUM_CHORDS,
      activation: 'softmax'
    }))

    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    })

    console.log('LSTM chord model built:', this.model.summary())
  }

  addTrainingExample(notes, chordLabel) {
    if (!notes || notes.length === 0) return false

    const chroma = notesToChromaMatrix(notes, 4, 4)
    const sequence = this.padSequence(chroma)
    const label = this.chordLabelToOneHot(chordLabel)

    if (sequence && label) {
      this.trainingData.push(sequence)
      this.trainingLabels.push(label)
      return true
    }
    return false
  }

  addTrainingExamplesFromAnnotations(annotations, allNotes) {
    let count = 0
    annotations.forEach(annot => {
      if (annot.type === 'chord' && annot.label) {
        const segmentNotes = allNotes.filter(n =>
          n.start_time >= annot.start_time &&
          n.start_time < annot.end_time
        )
        if (segmentNotes.length > 0) {
          if (this.addTrainingExample(segmentNotes, annot.label)) {
            count++
          }
        }
      }
    })
    return count
  }

  async train(epochs = 50, batchSize = 16) {
    if (this.trainingData.length < 5) {
      console.warn('Not enough training data, need at least 5 examples')
      return null
    }

    if (!this.model) {
      this.buildModel()
    }

    this.isTraining = true

    const xs = tf.tensor3d(this.trainingData)
    const ys = tf.tensor2d(this.trainingLabels)

    try {
      const history = await this.model.fit(xs, ys, {
        epochs,
        batchSize,
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(`Epoch ${epoch + 1}/${epochs}: loss=${logs.loss?.toFixed(4)}, acc=${logs.acc?.toFixed(4)}`)
          }
        }
      })

      this.isTrained = true
      console.log('Training complete!')
      return history
    } catch (error) {
      console.error('Training error:', error)
      return null
    } finally {
      this.isTraining = false
      xs.dispose()
      ys.dispose()
    }
  }

  predict(notes) {
    if (!this.model || !this.isTrained || !notes || notes.length === 0) {
      return null
    }

    return tf.tidy(() => {
      const chroma = notesToChromaMatrix(notes, 4, 4)
      const sequence = this.padSequence(chroma)
      const input = tf.tensor3d([sequence])
      const prediction = this.model.predict(input)
      const probabilities = Array.from(prediction.dataSync())

      const topPredictions = probabilities
        .map((prob, idx) => ({
          ...INDEX_TO_CHORD[idx],
          confidence: prob
        }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)

      return {
        top: topPredictions[0],
        predictions: topPredictions
      }
    })
  }

  predictTopK(notes, k = 5) {
    const result = this.predict(notes)
    return result ? result.predictions.slice(0, k) : []
  }

  padSequence(sequence) {
    const result = []
    for (let i = 0; i < this.sequenceLength; i++) {
      if (i < sequence.length) {
        result.push(sequence[i])
      } else {
        result.push(new Array(NUM_PITCH_CLASSES).fill(0))
      }
    }
    return result.slice(0, this.sequenceLength)
  }

  chordLabelToOneHot(label) {
    const oneHot = new Array(NUM_CHORDS).fill(0)
    const chordIndex = Object.values(INDEX_TO_CHORD).findIndex(c => c.label === label)
    if (chordIndex >= 0) {
      oneHot[chordIndex] = 1
      return oneHot
    }
    return null
  }

  getTrainingStats() {
    return {
      numExamples: this.trainingData.length,
      isTrained: this.isTrained,
      isTraining: this.isTraining
    }
  }

  resetModel() {
    if (this.model) {
      this.model.dispose()
      this.model = null
    }
    this.trainingData = []
    this.trainingLabels = []
    this.isTrained = false
  }

  async saveModel() {
    if (!this.model || !this.isTrained) return null
    try {
      const saveResult = await this.model.save('localstorage://chord-model')
      console.log('Model saved to localStorage')
      return saveResult
    } catch (error) {
      console.error('Failed to save model:', error)
      return null
    }
  }

  async loadModel() {
    try {
      this.model = await tf.loadLayersModel('localstorage://chord-model')
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      })
      this.isTrained = true
      console.log('Model loaded from localStorage')
      return true
    } catch (error) {
      console.log('No saved model found')
      return false
    }
  }
}

export const chordModel = new ChordPredictionModel()
export default chordModel
