import React, { useState, useCallback } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Container,
  Box,
  Typography,
  AppBar,
  Toolbar,
  Button,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  MusicNote as MusicIcon,
  Upload as UploadIcon,
  History as HistoryIcon,
  Info as InfoIcon,
  DarkMode as DarkIcon,
  LightMode as LightIcon,
  GetApp as DownloadIcon,
  CompareArrows as CompareIcon,
} from '@mui/icons-material';
import MidiUpload from './components/MidiUpload';
import AnalysisResults from './components/AnalysisResults';
import WaveformVisualizer from './components/WaveformVisualizer';
import AnalysisHistory from './components/AnalysisHistory';
import AnalysisComparison from './components/AnalysisComparison';
import { getAnalysis, getWaveform, exportAnalysis, downloadBlob } from './services/api';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#9c27b0',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
  },
  components: {
    MuiPaper: {
      defaultProps: {
        elevation: 2,
      },
    },
  },
});

const darkTheme = createTheme({
  ...theme,
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#ce93d8',
    },
  },
});

function App() {
  const [currentTab, setCurrentTab] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState(null);
  const [waveformData, setWaveformData] = useState(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const loadAnalysis = useCallback(async (id) => {
    try {
      const [analysis, waveform] = await Promise.all([
        getAnalysis(id),
        getWaveform(id, 200),
      ]);
      setSelectedAnalysis(analysis);
      setWaveformData(waveform);
      setCurrentTab(0);
    } catch (err) {
      console.error('Failed to load analysis:', err);
    }
  }, []);

  const handleUploadComplete = useCallback((batchStatus) => {
    setHistoryRefresh(prev => prev + 1);
    const completed = batchStatus.analyses.find(a => a.status === 'completed');
    if (completed) {
      loadAnalysis(completed.id);
    }
  }, [loadAnalysis]);

  const handleExport = useCallback(async () => {
    if (!selectedAnalysis) return;
    try {
      const blob = await exportAnalysis(selectedAnalysis.id);
      downloadBlob(blob, `analysis_${selectedAnalysis.id}.json`);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [selectedAnalysis]);

  const handleNewAnalysis = useCallback(() => {
    setSelectedAnalysis(null);
    setWaveformData(null);
  }, []);

  return (
    <ThemeProvider theme={darkMode ? darkTheme : theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <AppBar position="static">
          <Toolbar>
            <MusicIcon sx={{ mr: 2 }} />
            <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
              MIDI Music Analyzer
            </Typography>
            
            <Tabs
              value={currentTab}
              onChange={(_, v) => setCurrentTab(v)}
              sx={{ mr: 2 }}
              textColor="inherit"
              TabIndicatorProps={{ style: { backgroundColor: 'white' } }}
            >
              <Tab
                icon={<UploadIcon />}
                label="Analyze"
                iconPosition="start"
              />
              <Tab
                icon={<CompareIcon />}
                label="Compare"
                iconPosition="start"
              />
              <Tab
                icon={<HistoryIcon />}
                label="History"
                iconPosition="start"
              />
            </Tabs>

            {selectedAnalysis && (
              <Tooltip title="Export Report">
                <IconButton color="inherit" onClick={handleExport} sx={{ mr: 1 }}>
                  <DownloadIcon />
                </IconButton>
              </Tooltip>
            )}

            {selectedAnalysis && (
              <Button
                color="inherit"
                onClick={handleNewAnalysis}
                sx={{ mr: 1 }}
              >
                New Analysis
              </Button>
            )}

            <Tooltip title={darkMode ? 'Light Mode' : 'Dark Mode'}>
              <IconButton
                color="inherit"
                onClick={() => setDarkMode(!darkMode)}
              >
                {darkMode ? <LightIcon /> : <DarkIcon />}
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Container maxWidth="xl" sx={{ mt: 4, mb: 4, flex: 1 }}>
          {currentTab === 0 ? (
            <>
              {!selectedAnalysis ? (
                <>
                  <Box sx={{ mb: 4, textAlign: 'center' }}>
                    <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold' }}>
                      AI-Powered MIDI Analysis
                    </Typography>
                    <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
                      Upload your MIDI files to get instant analysis including music style classification,
                      emotion detection, chord progression analysis, and instrument breakdown.
                    </Typography>
                  </Box>

                  <MidiUpload onUploadComplete={handleUploadComplete} />

                  <Box sx={{ mt: 6, display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
                    {[
                      { icon: '🎵', title: 'Style Classification', desc: 'Pop, Jazz, Classical, Rock, Electronic & more' },
                      { icon: '😊', title: 'Emotion Detection', desc: 'Happy, Sad, Energetic, Calm, Romantic & more' },
                      { icon: '🎹', title: 'Instrument Analysis', desc: 'Piano, Guitar, Drums, Strings, Brass & more' },
                      { icon: '🎼', title: 'Chord Progression', desc: 'Major, Minor, 7th, Diminished & more' },
                      { icon: '📊', title: 'Waveform Visualizer', desc: 'Interactive playback with section highlighting' },
                      { icon: '📁', title: 'Batch Processing', desc: 'Upload up to 10 MIDI files at once' },
                    ].map((feature, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          p: 3,
                          bgcolor: 'background.paper',
                          borderRadius: 2,
                          width: 280,
                          textAlign: 'center',
                        }}
                      >
                        <Typography variant="h3" sx={{ mb: 1 }}>{feature.icon}</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 'medium', mb: 1 }}>
                          {feature.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {feature.desc}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              ) : (
                <>
                  <WaveformVisualizer
                    analysis={selectedAnalysis}
                    waveformData={waveformData}
                    sections={selectedAnalysis.sections}
                    chords={selectedAnalysis.chords}
                  />
                  <AnalysisResults analysis={selectedAnalysis} />
                </>
              )}
            </>
          ) : currentTab === 1 ? (
            <AnalysisComparison />
          ) : (
            <AnalysisHistory
              onSelectAnalysis={loadAnalysis}
              onRefresh={historyRefresh}
            />
          )}
        </Container>

        <Box
          component="footer"
          sx={{
            py: 3,
            px: 2,
            mt: 'auto',
            textAlign: 'center',
            bgcolor: 'background.paper',
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            MIDI Music Analyzer © {new Date().getFullYear()} | Powered by Node.js + Python + ONNX Runtime
          </Typography>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
