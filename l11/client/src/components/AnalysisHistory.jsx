import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Button,
  Checkbox,
  LinearProgress,
  Pagination,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Pending as PendingIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import {
  getAnalysisList,
  deleteAnalysis,
  exportAnalysis,
  exportBatch,
  downloadBlob,
} from '../services/api';

const AnalysisHistory = ({ onSelectAnalysis, onRefresh }) => {
  const [analyses, setAnalyses] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const loadAnalyses = async () => {
    setLoading(true);
    try {
      const data = await getAnalysisList(limit, (page - 1) * limit);
      setAnalyses(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load analyses:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalyses();
  }, [page]);

  useEffect(() => {
    if (onRefresh) {
      loadAnalyses();
    }
  }, [onRefresh]);

  const handleSelectAll = (event) => {
    if (event.target.checked) {
      setSelected(analyses.map(a => a.id));
    } else {
      setSelected([]);
    }
  };

  const handleSelect = (id) => {
    setSelected(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleDelete = async (id) => {
    try {
      await deleteAnalysis(id);
      setConfirmDelete(null);
      loadAnalyses();
      setSelected(prev => prev.filter(i => i !== id));
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleExport = async (id) => {
    try {
      const blob = await exportAnalysis(id);
      downloadBlob(blob, `analysis_${id}.json`);
    } catch (err) {
      console.error('Failed to export:', err);
    }
  };

  const handleBatchExport = async () => {
    if (selected.length === 0) return;
    try {
      const blob = await exportBatch(selected);
      downloadBlob(blob, `batch_export_${Date.now()}.json`);
    } catch (err) {
      console.error('Failed to batch export:', err);
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <SuccessIcon color="success" fontSize="small" />;
      case 'failed': return <ErrorIcon color="error" fontSize="small" />;
      case 'processing': return <PendingIcon color="warning" fontSize="small" />;
      default: return <PendingIcon fontSize="small" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'success';
      case 'failed': return 'error';
      case 'processing': return 'warning';
      default: return 'default';
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <Paper sx={{ mt: 4, p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 'medium' }}>
          Analysis History ({total} total)
        </Typography>
        <Box>
          <Button
            startIcon={<RefreshIcon />}
            onClick={loadAnalyses}
            sx={{ mr: 1 }}
          >
            Refresh
          </Button>
          {selected.length > 0 && (
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={handleBatchExport}
            >
              Export Selected ({selected.length})
            </Button>
          )}
        </Box>
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  indeterminate={selected.length > 0 && selected.length < analyses.length}
                  checked={analyses.length > 0 && selected.length === analyses.length}
                  onChange={handleSelectAll}
                />
              </TableCell>
              <TableCell>File Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Genre</TableCell>
              <TableCell>Emotion</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell>Size</TableCell>
              <TableCell>Upload Date</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {analyses.map((analysis) => (
              <TableRow
                key={analysis.id}
                hover
                selected={selected.includes(analysis.id)}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={selected.includes(analysis.id)}
                    onChange={() => handleSelect(analysis.id)}
                    disabled={analysis.status !== 'completed'}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                    {analysis.original_name}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    icon={getStatusIcon(analysis.status)}
                    label={analysis.status}
                    color={getStatusColor(analysis.status)}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  {analysis.primary_genre ? (
                    <Chip label={analysis.primary_genre} size="small" />
                  ) : '-'}
                </TableCell>
                <TableCell>
                  {analysis.primary_emotion ? (
                    <Chip label={analysis.primary_emotion} size="small" color="secondary" />
                  ) : '-'}
                </TableCell>
                <TableCell>
                  {analysis.duration_seconds ? `${analysis.duration_seconds.toFixed(1)}s` : '-'}
                </TableCell>
                <TableCell>{formatFileSize(analysis.file_size)}</TableCell>
                <TableCell>{formatDate(analysis.upload_time)}</TableCell>
                <TableCell align="right">
                  <IconButton
                    size="small"
                    onClick={() => onSelectAnalysis && onSelectAnalysis(analysis.id)}
                    disabled={analysis.status !== 'completed'}
                    title="View Details"
                  >
                    <ViewIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleExport(analysis.id)}
                    disabled={analysis.status !== 'completed'}
                    title="Export JSON"
                  >
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setConfirmDelete(analysis.id)}
                    color="error"
                    title="Delete"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, p) => setPage(p)}
            color="primary"
          />
        </Box>
      )}

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this analysis? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            onClick={() => confirmDelete && handleDelete(confirmDelete)}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default AnalysisHistory;
