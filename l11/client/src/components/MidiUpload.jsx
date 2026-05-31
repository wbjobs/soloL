import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Button,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Paper,
} from '@mui/material';
import {
  Upload as UploadIcon,
  Description as FileIcon,
  Close as CloseIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  MusicNote as MusicIcon,
} from '@mui/icons-material';
import { uploadFiles, getBatchStatus, getAnalysisStatus } from '../services/api';

const MAX_FILES = 10;

const MidiUpload = ({ onUploadComplete }) => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [batchId, setBatchId] = useState(null);
  const [progress, setProgress] = useState({});
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files);
    const midiFiles = files.filter(f => 
      f.name.toLowerCase().endsWith('.mid') || 
      f.name.toLowerCase().endsWith('.midi')
    );
    
    if (midiFiles.length !== files.length) {
      setError('Only .mid and .midi files are allowed');
    }
    
    setSelectedFiles(prev => {
      const combined = [...prev, ...midiFiles].slice(0, MAX_FILES);
      return combined;
    });
    setError(null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const midiFiles = files.filter(f => 
      f.name.toLowerCase().endsWith('.mid') || 
      f.name.toLowerCase().endsWith('.midi')
    );
    
    setSelectedFiles(prev => {
      const combined = [...prev, ...midiFiles].slice(0, MAX_FILES);
      return combined;
    });
    setError(null);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const removeFile = useCallback((index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleUpload = useCallback(async () => {
    if (selectedFiles.length === 0) return;
    
    setUploading(true);
    setError(null);
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    try {
      const result = await uploadFiles(selectedFiles);
      const currentBatchId = result.batch_id;
      setBatchId(currentBatchId);
      
      const initialProgress = {};
      result.analyses.forEach(a => {
        initialProgress[a.analysis_id] = { 
          status: 'queued', 
          name: a.original_name,
          id: a.analysis_id 
        };
      });
      setProgress(initialProgress);
      
      let pollAttempts = 0;
      const maxAttempts = 3600;
      
      pollIntervalRef.current = setInterval(async () => {
        pollAttempts++;
        if (pollAttempts > maxAttempts) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setUploading(false);
          setError('Processing timed out after 2 hours');
          return;
        }
        
        try {
          const [batchStatus, ...individualStatuses] = await Promise.all([
            getBatchStatus(currentBatchId),
            ...result.analyses.map(a => getAnalysisStatus(a.analysis_id).catch(() => null))
          ]);
          
          setProgress(prevProgress => {
            const newProgress = { ...prevProgress };
            
            batchStatus.analyses.forEach(a => {
              newProgress[a.id] = { 
                status: a.status, 
                name: a.original_name,
                id: a.id
              };
            });
            
            individualStatuses.forEach(status => {
              if (status && status.analysis_id) {
                newProgress[status.analysis_id] = {
                  ...newProgress[status.analysis_id],
                  status: status.status,
                  progress: status.progress,
                  error: status.error,
                  worker_id: status.worker_id,
                };
              }
            });
            
            return newProgress;
          });
          
          if (batchStatus.status === 'completed' || 
              batchStatus.status === 'failed' || 
              batchStatus.status === 'partial') {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setUploading(false);
            if (onUploadComplete) {
              onUploadComplete(batchStatus);
            }
          }
        } catch (e) {
          console.error('Polling error:', e);
          if (e.response?.status === 404) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setUploading(false);
            setError('Batch not found');
          }
        }
      }, 2000);
      
    } catch (err) {
      setUploading(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setError(err.response?.data?.error || 'Upload failed');
    }
  }, [selectedFiles, onUploadComplete]);

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'success';
      case 'failed': return 'error';
      case 'processing': return 'warning';
      default: return 'default';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <SuccessIcon color="success" />;
      case 'failed': return <ErrorIcon color="error" />;
      case 'processing': return <CircularProgress size={20} />;
      default: return <CircularProgress size={20} variant="determinate" value={0} />;
    }
  };

  return (
    <Box>
      <Paper
        sx={{
          border: '2px dashed',
          borderColor: 'primary.main',
          borderRadius: 2,
          p: 4,
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s',
          '&:hover': {
            backgroundColor: 'action.hover',
            borderColor: 'primary.dark',
          },
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('midi-file-input').click()}
      >
        <input
          id="midi-file-input"
          type="file"
          accept=".mid,.midi"
          multiple
          hidden
          onChange={handleFileSelect}
          disabled={uploading || selectedFiles.length >= MAX_FILES}
        />
        <UploadIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          Drop MIDI files here or click to browse
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Supports .mid and .midi files. Maximum {MAX_FILES} files per upload.
        </Typography>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {selectedFiles.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1">
              Selected Files ({selectedFiles.length}/{MAX_FILES})
            </Typography>
            <Box>
              <Button
                onClick={() => setSelectedFiles([])}
                disabled={uploading}
                sx={{ mr: 1 }}
              >
                Clear All
              </Button>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={handleUpload}
                disabled={uploading || selectedFiles.length === 0}
              >
                {uploading ? 'Processing...' : 'Analyze Files'}
              </Button>
            </Box>
          </Box>

          <List>
            {selectedFiles.map((file, index) => (
              <ListItem
                key={index}
                secondaryAction={
                  !uploading && (
                    <IconButton edge="end" onClick={() => removeFile(index)}>
                      <CloseIcon />
                    </IconButton>
                  )
                }
              >
                <ListItemIcon>
                  {progress[file.name]?.status ? (
                    getStatusIcon(progress[file.name]?.status)
                  ) : (
                    <MusicIcon color="primary" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={file.name}
                  secondary={formatFileSize(file.size)}
                />
                {progress[file.name]?.status && (
                  <Chip
                    label={progress[file.name].status}
                    color={getStatusColor(progress[file.name].status)}
                    size="small"
                    sx={{ mr: 2 }}
                  />
                )}
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );
};

export default MidiUpload;
