import { jsPDF } from 'jspdf'
import { CHORD_TYPES } from '../utils/chordUtils'

export function generateAnnotationReport(midiInfo, annotations, notes, spectrumDataUrl = null) {
  const doc = new jsPDF('p', 'mm', 'a4')
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 20
  const contentWidth = pageWidth - 2 * margin
  
  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text('MIDI Annotation Report', pageWidth / 2, y, { align: 'center' })
  y += 15

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, y, { align: 'center' })
  y += 15

  doc.setDrawColor(0, 0, 0)
  doc.line(margin, y, pageWidth - margin, y)
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('MIDI File Information', margin, y)
  y += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  
  const infoItems = [
    ['Filename:', midiInfo?.filename || 'N/A'],
    ['Tracks:', midiInfo?.num_tracks || 0],
    ['Total Notes:', midiInfo?.num_notes || notes?.length || 0],
    ['Duration:', `${midiInfo?.duration?.toFixed(2) || 0}s`],
    ['Tempo:', `${midiInfo?.tempo || 120} BPM`],
    ['Time Signature:', midiInfo?.time_signature || '4/4']
  ]

  infoItems.forEach(([label, value]) => {
    doc.text(label, margin + 5, y)
    doc.text(String(value), margin + 40, y)
    y += 6
  })

  y += 5

  if (spectrumDataUrl) {
    y = addNewPageIfNeeded(doc, y, 80, pageHeight, margin)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Spectrum Waterfall', margin, y)
    y += 8
    
    try {
      doc.addImage(spectrumDataUrl, 'PNG', margin, y, contentWidth, 60)
      y += 70
    } catch (e) {
      console.warn('Could not add spectrum image:', e)
      y += 10
    }
  }

  y = addNewPageIfNeeded(doc, y, 40, pageHeight, margin)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Annotation Statistics', margin, y)
  y += 8

  const stats = calculateStats(annotations, notes)
  
  const statItems = [
    ['Total Annotations:', annotations?.length || 0],
    ['Chord Annotations:', stats.chordCount],
    ['Melody Annotations:', stats.melodyCount],
    ['Other Annotations:', stats.otherCount],
    ['Annotated Duration:', `${stats.totalAnnotatedDuration.toFixed(2)}s`],
    ['Coverage:', `${(stats.coverage * 100).toFixed(1)}%`]
  ]

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  statItems.forEach(([label, value]) => {
    doc.text(label, margin + 5, y)
    doc.text(String(value), margin + 50, y)
    y += 6
  })

  y += 10

  if (stats.chordDistribution.length > 0) {
    y = addNewPageIfNeeded(doc, y, 40, pageHeight, margin)
    
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('Chord Distribution', margin, y)
    y += 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    
    const chordsPerRow = 4
    stats.chordDistribution.slice(0, 16).forEach((chord, i) => {
      const col = i % chordsPerRow
      const row = Math.floor(i / chordsPerRow)
      const x = margin + col * (contentWidth / chordsPerRow)
      const labelY = y + row * 6
      
      doc.text(`${chord.label}:`, x, labelY)
      doc.text(`${chord.count}`, x + 25, labelY)
    })
    
    y += Math.ceil(Math.min(stats.chordDistribution.length, 16) / chordsPerRow) * 6 + 10
  }

  y = addNewPageIfNeeded(doc, y, 40, pageHeight, margin)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('Detailed Annotations', margin, y)
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('#', margin, y)
  doc.text('Type', margin + 8, y)
  doc.text('Label', margin + 25, y)
  doc.text('Start', margin + 60, y)
  doc.text('End', margin + 80, y)
  doc.text('Dur(s)', margin + 100, y)
  doc.text('Notes', margin + 120, y)
  doc.text('Description', margin + 140, y)
  y += 5

  doc.setDrawColor(200, 200, 200)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  const maxAnnotationsPerPage = 20
  
  annotations?.forEach((annot, index) => {
    y = addNewPageIfNeeded(doc, y, 6, pageHeight, margin)
    
    const duration = (annot.end_time - annot.start_time).toFixed(2)
    const noteCount = getNotesInRange(notes, annot.start_time, annot.end_time).length
    
    doc.text(String(index + 1), margin, y)
    doc.text(annot.type || '-', margin + 8, y)
    doc.text(annot.label || '-', margin + 25, y)
    doc.text(annot.start_time.toFixed(2), margin + 60, y)
    doc.text(annot.end_time.toFixed(2), margin + 80, y)
    doc.text(duration, margin + 100, y)
    doc.text(String(noteCount), margin + 120, y)
    doc.text(annot.description?.substring(0, 30) || '-', margin + 140, y)
    y += 5
  })

  return doc
}

function addNewPageIfNeeded(doc, currentY, requiredSpace, pageHeight, margin) {
  if (currentY + requiredSpace > pageHeight - margin) {
    doc.addPage()
    return margin
  }
  return currentY
}

function calculateStats(annotations, notes) {
  if (!annotations || annotations.length === 0) {
    return {
      chordCount: 0,
      melodyCount: 0,
      otherCount: 0,
      totalAnnotatedDuration: 0,
      coverage: 0,
      chordDistribution: []
    }
  }

  let chordCount = 0
  let melodyCount = 0
  let otherCount = 0
  let totalAnnotatedDuration = 0
  const chordCounts = {}

  annotations.forEach(annot => {
    totalAnnotatedDuration += annot.end_time - annot.start_time
    
    if (annot.type === 'chord') {
      chordCount++
      if (annot.label) {
        chordCounts[annot.label] = (chordCounts[annot.label] || 0) + 1
      }
    } else if (annot.type === 'melody') {
      melodyCount++
    } else {
      otherCount++
    }
  })

  const maxEndTime = notes?.length > 0 ? Math.max(...notes.map(n => n.start_time + n.duration)) : 0
  const coverage = maxEndTime > 0 ? totalAnnotatedDuration / maxEndTime : 0

  const chordDistribution = Object.entries(chordCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  return {
    chordCount,
    melodyCount,
    otherCount,
    totalAnnotatedDuration,
    coverage: Math.min(coverage, 1),
    chordDistribution
  }
}

function getNotesInRange(notes, startTime, endTime) {
  if (!notes) return []
  return notes.filter(n => 
    n.start_time >= startTime && n.start_time < endTime
  )
}

export function downloadReport(midiInfo, annotations, notes, spectrumDataUrl = null, filename = 'annotation-report.pdf') {
  const doc = generateAnnotationReport(midiInfo, annotations, notes, spectrumDataUrl)
  doc.save(filename)
}

export function generateReportBlob(midiInfo, annotations, notes, spectrumDataUrl = null) {
  const doc = generateAnnotationReport(midiInfo, annotations, notes, spectrumDataUrl)
  return doc.output('blob')
}

export default {
  generateAnnotationReport,
  downloadReport,
  generateReportBlob
}
