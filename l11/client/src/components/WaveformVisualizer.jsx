import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, IconButton, Slider, Paper, Tooltip } from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  SkipNext as SkipNextIcon,
  SkipPrevious as SkipPrevIcon,
  VolumeUp as VolumeIcon,
  VolumeOff as MuteIcon,
} from '@mui/icons-material';
import * as Tone from 'tone';

const WaveformVisualizer = ({ analysis, waveformData, sections, chords }) => {
  const canvasRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [activeSection, setActiveSection] = useState(null);
  const animationRef = useRef(null);
  const synthRef = useRef(null);
  const notesRef = useRef([]);
  const startTimeRef = useRef(null);

  const duration = analysis?.duration_seconds || 60;
  const waveform = waveformData?.waveform || [];

  useEffect(() => {
    synthRef.current = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 1 },
    }).toDestination();
    
    synthRef.current.volume.value = Tone.gainToDb(volume);

    if (analysis?.notes) {
      notesRef.current = analysis.notes.map(n => ({
        ...n,
        note: Tone.Frequency(n.pitch, 'midi').toNote(),
      }));
    }

    return () => {
      if (synthRef.current) {
        synthRef.current.dispose();
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      Tone.Transport.stop();
      Tone.Transport.cancel();
    };
  }, [analysis]);

  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.volume.value = isMuted ? -Infinity : Tone.gainToDb(volume);
    }
  }, [volume, isMuted]);

  const drawWaveform = useCallback((playbackTime = 0) => {
    const canvas = canvasRef.current;
    if (!canvas || waveform.length === 0) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(25, 118, 210, 0.3)');
    gradient.addColorStop(0.5, 'rgba(25, 118, 210, 0.6)');
    gradient.addColorStop(1, 'rgba(25, 118, 210, 0.3)');

    const barWidth = width / waveform.length;
    const centerY = height / 2;

    waveform.forEach((value, i) => {
      const x = i * barWidth;
      const barHeight = value * height * 0.8;
      
      if (i / waveform.length * duration <= playbackTime) {
        ctx.fillStyle = 'rgba(76, 175, 80, 0.7)';
      } else {
        ctx.fillStyle = gradient;
      }
      
      ctx.fillRect(
        x + 1,
        centerY - barHeight / 2,
        Math.max(barWidth - 2, 1),
        barHeight
      );
    });

    if (sections) {
      const sectionColors = [
        '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
        '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe'
      ];
      
      sections.forEach((section, idx) => {
        const startX = (section.start_time / duration) * width;
        const endX = (section.end_time / duration) * width;
        const color = sectionColors[idx % sectionColors.length];
        
        ctx.fillStyle = color + '30';
        ctx.fillRect(startX, 0, endX - startX, height);
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(startX, 0);
        ctx.lineTo(startX, height);
        ctx.stroke();
        
        ctx.fillStyle = color;
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(section.label, startX + 4, 12);
      });
    }

    if (chords) {
      chords.forEach((chord) => {
        const x = (chord.start_time / duration) * width;
        ctx.fillStyle = '#ff9800';
        ctx.font = '9px sans-serif';
        ctx.fillText(chord.name, x + 2, height - 4);
      });
    }

    const playheadX = (playbackTime / duration) * width;
    ctx.strokeStyle = '#f44336';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = '#f44336';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, 0);
    ctx.lineTo(playheadX + 6, 0);
    ctx.lineTo(playheadX, 8);
    ctx.closePath();
    ctx.fill();
  }, [waveform, duration, sections, chords]);

  useEffect(() => {
    drawWaveform(currentTime);
  }, [waveform, drawWaveform, currentTime]);

  const animate = useCallback((timestamp) => {
    if (!startTimeRef.current) {
      startTimeRef.current = timestamp - currentTime * 1000;
    }
    
    const elapsed = (timestamp - startTimeRef.current) / 1000;
    const newTime = Math.min(elapsed, duration);
    
    setCurrentTime(newTime);
    
    if (sections) {
      const current = sections.find(
        s => newTime >= s.start_time && newTime < s.end_time
      );
      setActiveSection(current);
    }

    if (newTime < duration && isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setIsPlaying(false);
      startTimeRef.current = null;
    }
  }, [duration, isPlaying, sections, currentTime]);

  useEffect(() => {
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
      
      if (Tone.Transport.state !== 'started') {
        Tone.Transport.start();
      }
      
      notesRef.current.forEach(note => {
        if (note.start_time >= currentTime) {
          Tone.Transport.schedule((time) => {
            if (synthRef.current) {
              synthRef.current.triggerAttackRelease(
                note.note,
                note.duration,
                time,
                note.velocity / 127
              );
            }
          }, note.start_time - currentTime);
        }
      });
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      Tone.Transport.pause();
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (currentTime >= duration) {
      setCurrentTime(0);
      Tone.Transport.cancel();
    }
    startTimeRef.current = null;
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (_, value) => {
    setCurrentTime(value);
    startTimeRef.current = null;
    Tone.Transport.cancel();
    
    if (isPlaying) {
      notesRef.current.forEach(note => {
        if (note.start_time >= value) {
          Tone.Transport.schedule((time) => {
            if (synthRef.current) {
              synthRef.current.triggerAttackRelease(
                note.note,
                note.duration,
                time,
                note.velocity / 127
              );
            }
          }, note.start_time - value);
        }
      });
    }
  };

  const skipBackward = () => {
    handleSeek(null, Math.max(0, currentTime - 5));
  };

  const skipForward = () => {
    handleSeek(null, Math.min(duration, currentTime + 5));
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Paper sx={{ p: 3, mt: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">Waveform & Timeline</Typography>
        {activeSection && (
          <Chip label={`Section: ${activeSection.label}`} color="primary" size="small" />
        )}
      </Box>
      
      <Box
        ref={(el) => {
          if (el) {
            const rect = el.getBoundingClientRect();
            canvasRef.current && (canvasRef.current.style.width = rect.width + 'px');
          }
        }}
        sx={{ position: 'relative', width: '100%', height: 150, mb: 2 }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', borderRadius: 4 }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const seekTime = (x / rect.width) * duration;
            handleSeek(null, seekTime);
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <IconButton onClick={skipBackward} disabled={duration === 0}>
          <SkipPrevIcon />
        </IconButton>
        <IconButton 
          onClick={togglePlay} 
          color="primary"
          disabled={duration === 0}
          sx={{ bgcolor: 'primary.main', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton onClick={skipForward} disabled={duration === 0}>
          <SkipNextIcon />
        </IconButton>

        <Typography variant="body2" sx={{ minWidth: 80 }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </Typography>

        <Box sx={{ flex: 1, px: 2 }}>
          <Slider
            value={currentTime}
            min={0}
            max={duration || 100}
            step={0.1}
            onChange={handleSeek}
            disabled={duration === 0}
          />
        </Box>

        <Tooltip title={isMuted ? 'Unmute' : 'Mute'}>
          <IconButton onClick={() => setIsMuted(!isMuted)}>
            {isMuted ? <MuteIcon /> : <VolumeIcon />}
          </IconButton>
        </Tooltip>
        <Box sx={{ width: 100 }}>
          <Slider
            value={isMuted ? 0 : volume * 100}
            min={0}
            max={100}
            onChange={(_, v) => { setVolume(v / 100); setIsMuted(false); }}
          />
        </Box>
      </Box>
    </Paper>
  );
};

export default WaveformVisualizer;
