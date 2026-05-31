import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  TextField,
  Button,
  Chip,
  IconButton,
  Divider,
  CircularProgress,
  Alert,
  Avatar,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  ListItemButton,
  Checkbox,
  Badge,
  Tabs,
  Tab,
  Card,
  CardContent,
} from '@mui/material';
import {
  CompareArrows,
  Search,
  Close,
  MusicNote,
  TrendingUp,
  BarChart as BarChartIcon,
  RadioButtonChecked,
} from '@mui/icons-material';
import ReactECharts from 'echarts-for-react';
import {
  getAnalysisList,
  searchAnalysesByTags,
  compareAnalyses,
} from '../services/api';

const AnalysisComparison = () => {
  const [selected1, setSelected1] = useState(null);
  const [selected2, setSelected2] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [allAnalyses, setAllAnalyses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [selectMode, setSelectMode] = useState(null);

  useEffect(() => {
    loadAnalyses();
  }, []);

  useEffect(() => {
    if (selected1 && selected2) {
      handleCompare();
    }
  }, [selected1, selected2]);

  const loadAnalyses = async () => {
    try {
      setLoading(true);
      const data = await getAnalysisList(50, 0);
      const completed = data.filter(a => a.status === 'completed');
      setAllAnalyses(completed);
      setSearchResults(completed);
    } catch (err) {
      setError('Failed to load analyses');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults(allAnalyses);
      return;
    }
    try {
      setLoading(true);
      const data = await searchAnalysesByTags(searchQuery, 30);
      setSearchResults(data.results);
    } catch (err) {
      setError('Search failed');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, allAnalyses]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      handleSearch();
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, handleSearch]);

  const handleSelect = (analysis) => {
    if (selectMode === 1) {
      setSelected1(analysis);
    } else if (selectMode === 2) {
      setSelected2(analysis);
    }
    setSelectMode(null);
  };

  const handleCompare = async () => {
    if (!selected1 || !selected2) return;
    try {
      setComparing(true);
      setError('');
      const result = await compareAnalyses(selected1.id, selected2.id);
      setComparisonResult(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Comparison failed');
    } finally {
      setComparing(false);
    }
  };

  const clearSelection = () => {
    setSelected1(null);
    setSelected2(null);
    setComparisonResult(null);
    setError('');
  };

  const getKDEChartOption = () => {
    if (!comparisonResult?.rhythm_kde?.points) return {};
    
    const points = comparisonResult.rhythm_kde.points;
    const name1 = comparisonResult.name1;
    const name2 = comparisonResult.name2;
    
    const xData = points.map(p => p.x.toFixed(3));
    const y1Data = points.map(p => p.y1);
    const y2Data = points.map(p => p.y2);
    const diffArea = points.map(p => p.significant ? [p.y1, p.y2] : null);
    
    const peakData = comparisonResult.rhythm_kde.peak_positions || [];
    const peaks1 = peakData.filter(p => p.track === name1);
    const peaks2 = peakData.filter(p => p.track === name2);
    
    return {
      title: {
        text: 'Rhythm Density Curve Comparison',
        subtext: 'KDE Distribution of Note Inter-onset Intervals',
        left: 'center',
        textStyle: { fontSize: 16 },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const x = params[0]?.axisValue;
          let html = `<strong>Interval: ${x}s</strong><br/>`;
          params.forEach(p => {
            if (p.seriesType === 'line') {
              html += `${p.marker} ${p.seriesName}: ${p.value.toFixed(4)}<br/>`;
            }
          });
          return html;
        },
      },
      legend: {
        data: [name1, name2, 'Significant Difference'],
        top: 50,
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: 100,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xData,
        name: 'Interval (seconds)',
        nameLocation: 'middle',
        nameGap: 25,
        axisLabel: {
          rotate: 45,
          fontSize: 10,
          formatter: (val) => parseFloat(val).toFixed(2),
          interval: Math.floor(xData.length / 10),
        },
      },
      yAxis: {
        type: 'value',
        name: 'Density',
        nameLocation: 'middle',
        nameGap: 45,
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
        },
        {
          start: 0,
          end: 100,
          height: 20,
          bottom: 10,
        },
      ],
      series: [
        {
          name: name1,
          type: 'line',
          data: y1Data,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 3,
            color: '#3b82f6',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
                { offset: 1, color: 'rgba(59, 130, 246, 0.05)' },
              ],
            },
          },
          markPoint: {
            data: peaks1.map(p => ({
              name: 'Peak',
              coord: [p.x.toFixed(3), p.y],
              value: p.y.toFixed(3),
              itemStyle: { color: '#3b82f6' },
            })),
            symbolSize: 50,
            label: { show: false },
          },
        },
        {
          name: name2,
          type: 'line',
          data: y2Data,
          smooth: true,
          symbol: 'none',
          lineStyle: {
            width: 3,
            color: '#f97316',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(249, 115, 22, 0.3)' },
                { offset: 1, color: 'rgba(249, 115, 22, 0.05)' },
              ],
            },
          },
          markPoint: {
            data: peaks2.map(p => ({
              name: 'Peak',
              coord: [p.x.toFixed(3), p.y],
              value: p.y.toFixed(3),
              itemStyle: { color: '#f97316' },
            })),
            symbolSize: 50,
            label: { show: false },
          },
        },
        {
          name: 'Significant Difference',
          type: 'line',
          data: diffArea,
          stack: 'diff',
          lineStyle: { opacity: 0 },
          areaStyle: {
            color: 'rgba(239, 68, 68, 0.25)',
          },
          tooltip: { show: false },
        },
      ],
    };
  };

  const getChordRoseOption = () => {
    if (!comparisonResult?.chord_rose) return {};
    
    const rose = comparisonResult.chord_rose;
    const name1 = comparisonResult.name1;
    const name2 = comparisonResult.name2;
    const names = rose.names;
    
    const radiusMax = Math.min(window.innerWidth / 2 - 100, 400);
    
    return {
      title: {
        text: 'Chord Distribution - Polar Rose',
        subtext: 'Chord duration by type',
        left: 'center',
        textStyle: { fontSize: 16 },
      },
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          return `<strong>${params.name}</strong><br/>
                  ${name1}: ${params.data[0]?.toFixed(1) || 0}s<br/>
                  ${name2}: ${params.data[1]?.toFixed(1) || 0}s`;
        },
      },
      legend: {
        data: [name1, name2],
        top: 50,
      },
      polar: {
        radius: [30, radiusMax],
        center: ['50%', '55%'],
      },
      angleAxis: {
        type: 'category',
        data: names,
        boundaryGap: false,
        startAngle: 90,
        axisLabel: {
          fontSize: 12,
          fontWeight: 'bold',
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: 'rgba(0,0,0,0.1)',
          },
        },
      },
      radiusAxis: {
        type: 'value',
        axisLabel: {
          formatter: (val) => val.toFixed(0) + 's',
        },
      },
      series: [
        {
          name: name1,
          type: 'bar',
          data: rose.values1,
          coordinateSystem: 'polar',
          stack: null,
          itemStyle: {
            color: 'rgba(59, 130, 246, 0.7)',
            borderColor: '#3b82f6',
            borderWidth: 2,
          },
          emphasis: {
            itemStyle: {
              color: 'rgba(59, 130, 246, 0.9)',
            },
          },
        },
        {
          name: name2,
          type: 'bar',
          data: rose.values2,
          coordinateSystem: 'polar',
          stack: null,
          itemStyle: {
            color: 'rgba(249, 115, 22, 0.7)',
            borderColor: '#f97316',
            borderWidth: 2,
          },
          emphasis: {
            itemStyle: {
              color: 'rgba(249, 115, 22, 0.9)',
            },
          },
        },
      ],
    };
  };

  const SelectionCard = ({ label, selected, onSelect, onClear, slot }) => (
    <Card 
      sx={{ 
        height: '100%', 
        cursor: 'pointer',
        border: selectMode === slot ? 3 : 1,
        borderColor: selectMode === slot ? 'primary.main' : 'divider',
        transition: 'all 0.2s',
        '&:hover': {
          borderColor: 'primary.main',
          boxShadow: 2,
        },
      }}
      onClick={() => !selected && setSelectMode(slot)}
    >
      <CardContent>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle2" color="text.secondary">
            {label}
          </Typography>
          {selected && (
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); onClear(); }}>
              <Close fontSize="small" />
            </IconButton>
          )}
        </Box>
        
        {selected ? (
          <Box>
            <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
              {selected.original_name}
            </Typography>
            <Box display="flex" gap={1} flexWrap="wrap">
              <Chip 
                size="small" 
                icon={<MusicNote fontSize="small" />} 
                label={`${selected.note_count || 0} notes`} 
              />
              <Chip 
                size="small" 
                icon={<TrendingUp fontSize="small" />} 
                label={`${selected.tempo_bpm || '?'} BPM`} 
              />
              {selected.primary_genre && (
                <Chip size="small" label={selected.primary_genre} color="primary" variant="outlined" />
              )}
              {selected.primary_emotion && (
                <Chip size="small" label={selected.primary_emotion} color="secondary" variant="outlined" />
              )}
            </Box>
          </Box>
        ) : (
          <Box 
            display="flex" 
            flexDirection="column" 
            alignItems="center" 
            justifyContent="center"
            py={4}
            color="text.secondary"
          >
            <RadioButtonChecked sx={{ fontSize: 40, mb: 1, opacity: 0.5 }} />
            <Typography variant="body2">
              Click to select from list
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );

  const AnalysisListItem = ({ analysis }) => {
    const isSelected1 = selected1?.id === analysis.id;
    const isSelected2 = selected2?.id === analysis.id;
    const disabled = (selectMode === 1 && isSelected2) || (selectMode === 2 && isSelected1);
    
    return (
      <ListItem disablePadding>
        <ListItemButton 
          disabled={disabled}
          onClick={() => handleSelect(analysis)}
          sx={{
            borderLeft: isSelected1 ? '4px solid #3b82f6' : isSelected2 ? '4px solid #f97316' : '4px solid transparent',
            bgcolor: disabled ? 'action.disabledBackground' : 'inherit',
          }}
        >
          <ListItemAvatar>
            <Badge 
              overlap="circular"
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              badgeContent={
                isSelected1 ? '1' : isSelected2 ? '2' : null
              }
              sx={{
                '& .MuiBadge-badge': {
                  bgcolor: isSelected1 ? '#3b82f6' : '#f97316',
                  color: 'white',
                },
              }}
            >
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                <MusicNote />
              </Avatar>
            </Badge>
          </ListItemAvatar>
          <ListItemText
            primary={
              <Typography variant="body1" fontWeight={isSelected1 || isSelected2 ? 600 : 400}>
                {analysis.original_name}
              </Typography>
            }
            secondary={
              <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
                {analysis.primary_genre && (
                  <Chip size="small" label={analysis.primary_genre} variant="outlined" />
                )}
                {analysis.primary_emotion && (
                  <Chip size="small" label={analysis.primary_emotion} variant="outlined" color="secondary" />
                )}
                <Chip 
                  size="small" 
                  label={`${analysis.note_count || 0} notes`} 
                  variant="outlined" 
                />
              </Box>
            }
          />
          {(isSelected1 || isSelected2) && (
            <Checkbox checked color={isSelected1 ? 'primary' : 'warning'} />
          )}
        </ListItemButton>
      </ListItem>
    );
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="h4" sx={{ mb: 3, fontWeight: 700 }}>
        <CompareArrows sx={{ mr: 1, verticalAlign: 'middle' }} />
        MIDI Analysis Comparison
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={5}>
          <SelectionCard
            label="Track 1"
            selected={selected1}
            onClear={() => setSelected1(null)}
            slot={1}
          />
        </Grid>
        
        <Grid item xs={12} md={2}>
          <Box 
            display="flex" 
            flexDirection="column" 
            alignItems="center" 
            justifyContent="center"
            height="100%"
          >
            <CompareArrows sx={{ fontSize: 48, color: 'primary.main' }} />
            <Button 
              variant="outlined" 
              size="small"
              onClick={clearSelection}
              sx={{ mt: 2 }}
            >
              Clear All
            </Button>
          </Box>
        </Grid>
        
        <Grid item xs={12} md={5}>
          <SelectionCard
            label="Track 2"
            selected={selected2}
            onClear={() => setSelected2(null)}
            slot={2}
          />
        </Grid>
      </Grid>

      {selectMode && (
        <Alert severity="info" sx={{ mb: 3 }}>
          <strong>Selecting Track {selectMode}:</strong> Choose a track from the list below, or search for specific tags.
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={4}>
          <Paper sx={{ p: 2, height: '70vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              <BarChartIcon sx={{ mr: 1 }} />
              Available Analyses
            </Typography>
            
            <TextField
              fullWidth
              placeholder="Search by genre, emotion, instrument..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
              sx={{ mb: 2 }}
            />
            
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              {loading ? (
                <Box display="flex" justifyContent="center" py={4}>
                  <CircularProgress />
                </Box>
              ) : (
                <List dense>
                  {searchResults.length === 0 ? (
                    <ListItem>
                      <ListItemText primary="No analyses found" secondary="Complete some analyses first" />
                    </ListItem>
                  ) : (
                    searchResults.map(analysis => (
                      <AnalysisListItem key={analysis.id} analysis={analysis} />
                    ))
                  )}
                </List>
              )}
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} lg={8}>
          {comparing ? (
            <Paper sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh' }}>
              <CircularProgress size={60} sx={{ mb: 3 }} />
              <Typography variant="h6">
                Computing comparison...
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Calculating KDE curves and chord distributions
              </Typography>
            </Paper>
          ) : comparisonResult ? (
            <Paper sx={{ height: '70vh', display: 'flex', flexDirection: 'column' }}>
              <Tabs 
                value={activeTab} 
                onChange={(e, v) => setActiveTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider' }}
              >
                <Tab label="Rhythm Density (KDE)" icon={<TrendingUp />} iconPosition="start" />
                <Tab label="Chord Rose Diagram" icon={<BarChartIcon />} iconPosition="start" />
                <Tab label="Basic Stats" icon={<BarChartIcon />} iconPosition="start" />
              </Tabs>

              <Box sx={{ flex: 1, p: 2, overflow: 'auto' }}>
                {activeTab === 0 && (
                  <>
                    <Box sx={{ mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      <Chip 
                        color="primary"
                        label={`Overlap: ${(comparisonResult.rhythm_kde.overlapping_area * 100).toFixed(1)}%`}
                      />
                      <Chip 
                        label={`Mean Diff: ${comparisonResult.rhythm_kde.mean_diff.toFixed(4)}`}
                      />
                      <Chip 
                        label={`Peaks: ${comparisonResult.rhythm_kde.peak_positions?.length || 0}`}
                      />
                      <Chip 
                        color="success"
                        label={`Similarity: ${(comparisonResult.similarity_score * 100).toFixed(0)}%`}
                      />
                    </Box>
                    <ReactECharts 
                      option={getKDEChartOption()} 
                      style={{ height: 'calc(100% - 50px)', width: '100%' }}
                      notMerge={true}
                    />
                  </>
                )}
                
                {activeTab === 1 && (
                  <ReactECharts 
                    option={getChordRoseOption()} 
                    style={{ height: '100%', width: '100%' }}
                    notMerge={true}
                  />
                )}
                
                {activeTab === 2 && comparisonResult.basic_stats && (
                  <Grid container spacing={3} sx={{ mt: 1 }}>
                    <Grid item xs={12}>
                      <Typography variant="h6" sx={{ mb: 2 }}>Similarity Score</Typography>
                      <Typography variant="h2" color="primary" sx={{ fontWeight: 700 }}>
                        {(comparisonResult.similarity_score * 100).toFixed(0)}%
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Based on rhythm pattern (60%) and chord usage (40%)
                      </Typography>
                    </Grid>
                    
                    <Grid item xs={12}>
                      <Divider sx={{ my: 2 }} />
                    </Grid>
                    
                    {[
                      { label: 'Tempo (BPM)', v1: comparisonResult.basic_stats.time_signature2 ? null : comparisonResult.basic_stats.tempo_diff, attr1: comparisonResult.basic_stats.time_signature2 ? null : comparisonResult.name1, v2: comparisonResult.basic_stats.time_signature2, key: 'tempo' },
                      { label: 'Duration (s)', v1: comparisonResult.basic_stats.duration_diff, key: 'duration' },
                      { label: 'Note Count', v1: comparisonResult.basic_stats.note_count_diff, key: 'notes' },
                      { label: 'Track Count', v1: comparisonResult.basic_stats.track_count_diff, key: 'tracks' },
                    ].map(stat => (
                      stat.v1 !== null && (
                        <Grid item xs={12} sm={6} key={stat.key}>
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="body2" color="text.secondary" gutterBottom>
                                {stat.label}
                              </Typography>
                              <Typography variant="h4" sx={{ 
                                color: stat.v1 > 0 ? 'success.main' : stat.v1 < 0 ? 'error.main' : 'text.primary',
                                fontWeight: 600,
                              }}>
                                {stat.v1 > 0 ? '+' : ''}{stat.v1.toFixed ? stat.v1.toFixed(1) : stat.v1}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {comparisonResult.name1} vs {comparisonResult.name2}
                              </Typography>
                            </CardContent>
                          </Card>
                        </Grid>
                      )
                    ))}
                    
                    <Grid item xs={12}>
                      <Divider sx={{ my: 2 }} />
                    </Grid>
                    
                    <Grid item xs={6}>
                      <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, color: 'primary.main' }}>
                        {comparisonResult.name1}
                      </Typography>
                      {comparisonResult.basic_stats.primary_genre1 && (
                        <Typography variant="body2">
                          <strong>Genre:</strong> {comparisonResult.basic_stats.primary_genre1}
                        </Typography>
                      )}
                      {comparisonResult.basic_stats.primary_emotion1 && (
                        <Typography variant="body2">
                          <strong>Emotion:</strong> {comparisonResult.basic_stats.primary_emotion1}
                        </Typography>
                      )}
                      {comparisonResult.basic_stats.time_signature1 && (
                        <Typography variant="body2">
                          <strong>Time Sig:</strong> {comparisonResult.basic_stats.time_signature1}
                        </Typography>
                      )}
                      {comparisonResult.basic_stats.key_signature1 && (
                        <Typography variant="body2">
                          <strong>Key:</strong> {comparisonResult.basic_stats.key_signature1}
                        </Typography>
                      )}
                    </Grid>
                    
                    <Grid item xs={6}>
                      <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600, color: 'warning.main' }}>
                        {comparisonResult.name2}
                      </Typography>
                      {comparisonResult.basic_stats.primary_genre2 && (
                        <Typography variant="body2">
                          <strong>Genre:</strong> {comparisonResult.basic_stats.primary_genre2}
                        </Typography>
                      )}
                      {comparisonResult.basic_stats.primary_emotion2 && (
                        <Typography variant="body2">
                          <strong>Emotion:</strong> {comparisonResult.basic_stats.primary_emotion2}
                        </Typography>
                      )}
                      {comparisonResult.basic_stats.time_signature2 && (
                        <Typography variant="body2">
                          <strong>Time Sig:</strong> {comparisonResult.basic_stats.time_signature2}
                        </Typography>
                      )}
                      {comparisonResult.basic_stats.key_signature2 && (
                        <Typography variant="body2">
                          <strong>Key:</strong> {comparisonResult.basic_stats.key_signature2}
                        </Typography>
                      )}
                    </Grid>
                  </Grid>
                )}
              </Box>
            </Paper>
          ) : (
            <Paper sx={{ p: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '70vh', color: 'text.secondary' }}>
              <CompareArrows sx={{ fontSize: 80, mb: 3, opacity: 0.2 }} />
              <Typography variant="h6" sx={{ mb: 1 }}>
                Select two analyses to compare
              </Typography>
              <Typography variant="body2">
                Choose Track 1 and Track 2 from the list on the left
              </Typography>
            </Paper>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default AnalysisComparison;
