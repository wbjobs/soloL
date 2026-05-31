import React from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  LinearProgress,
  Card,
  CardContent,
} from '@mui/material';
import {
  MusicNote as MusicIcon,
  Speed as TempoIcon,
  Timer as DurationIcon,
  TrackChanges as TrackIcon,
  Piano as PianoIcon,
} from '@mui/icons-material';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

const AnalysisResults = ({ analysis }) => {
  if (!analysis) return null;

  const metadata = [
    { label: 'Duration', value: `${analysis.duration_seconds?.toFixed(1)}s`, icon: <DurationIcon /> },
    { label: 'Tempo', value: `${analysis.tempo_bpm} BPM`, icon: <TempoIcon /> },
    { label: 'Time Signature', value: analysis.time_signature, icon: <MusicIcon /> },
    { label: 'Key', value: analysis.key_signature, icon: <PianoIcon /> },
    { label: 'Total Notes', value: analysis.note_count?.toLocaleString(), icon: <MusicIcon /> },
    { label: 'Tracks', value: analysis.track_count, icon: <TrackIcon /> },
  ];

  const topGenres = analysis.style_tags?.slice(0, 5) || [];
  const topEmotions = analysis.emotion_tags?.slice(0, 5) || [];

  const valence = analysis.emotion_tags?.[0]?.valence || 0.5;
  const arousal = analysis.emotion_tags?.[0]?.arousal || 0.5;

  const emotionQuadrant = () => {
    if (valence > 0.5 && arousal > 0.5) return 'Happy / Excited';
    if (valence > 0.5 && arousal <= 0.5) return 'Calm / Relaxed';
    if (valence <= 0.5 && arousal > 0.5) return 'Angry / Tense';
    return 'Sad / Melancholic';
  };

  const instrumentData = analysis.instruments?.map((inst, idx) => ({
    name: inst.name,
    count: inst.note_count,
    color: COLORS[idx % COLORS.length],
  })) || [];

  const chordData = analysis.chords?.slice(0, 15).map((chord, idx) => ({
    name: chord.name,
    time: chord.start_time,
    duration: chord.duration,
    count: 1,
  })) || [];

  const radarData = [
    { subject: 'Rhythm', A: Math.min(100, analysis.tempo_bpm / 2), fullMark: 100 },
    { subject: 'Melody', A: analysis.note_count ? Math.min(100, analysis.note_count / 50) : 50, fullMark: 100 },
    { subject: 'Harmony', A: analysis.chords?.length ? Math.min(100, analysis.chords.length * 5) : 30, fullMark: 100 },
    { subject: 'Dynamics', A: (analysis.emotion_tags?.[0]?.confidence || 0.5) * 100, fullMark: 100 },
    { subject: 'Complexity', A: analysis.instruments?.length ? Math.min(100, analysis.instruments.length * 15) : 20, fullMark: 100 },
    { subject: 'Brightness', A: (analysis.emotion_tags?.[0]?.valence || 0.5) * 100, fullMark: 100 },
  ];

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
        Analysis Results: {analysis.original_name}
      </Typography>

      <Grid container spacing={3} sx={{ mb: 3 }}>
        {metadata.map((item, idx) => (
          <Grid item xs={6} sm={4} md={2} key={idx}>
            <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
              <CardContent sx={{ textAlign: 'center' }}>
                <Box sx={{ color: 'primary.main', mb: 1 }}>{item.icon}</Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  {item.label}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'medium' }}>
                  {item.value}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'medium', mb: 2 }}>
              🎵 Music Style Classification
            </Typography>
            {topGenres.map((tag, idx) => (
              <Box key={idx} sx={{ mb: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                    {tag.genre}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {(tag.confidence * 100).toFixed(1)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={tag.confidence * 100}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: 'action.hover',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: COLORS[idx % COLORS.length],
                    },
                  }}
                />
              </Box>
            ))}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'medium', mb: 2 }}>
              😊 Emotion Analysis
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Valence-Arousal Model
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  {emotionQuadrant()}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" display="block">
                  Valence: {(valence * 100).toFixed(0)}%
                </Typography>
                <Typography variant="caption" display="block">
                  Arousal: {(arousal * 100).toFixed(0)}%
                </Typography>
              </Box>
            </Box>

            {topEmotions.map((tag, idx) => (
              <Box key={idx} sx={{ mb: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                    {tag.emotion}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {(tag.confidence * 100).toFixed(1)}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={tag.confidence * 100}
                  sx={{
                    height: 8,
                    borderRadius: 4,
                    bgcolor: 'action.hover',
                    '& .MuiLinearProgress-bar': {
                      bgcolor: COLORS[(idx + 4) % COLORS.length],
                    },
                  }}
                />
              </Box>
            ))}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'medium', mb: 2 }}>
              🎹 Instrument Analysis
            </Typography>
            
            {instrumentData.length > 0 ? (
              <Box sx={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={instrumentData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {instrumentData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
            ) : (
              <Typography color="text.secondary">No instrument data available</Typography>
            )}

            {analysis.instruments?.length > 0 && (
              <TableContainer sx={{ mt: 2, maxHeight: 200 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Instrument</TableCell>
                      <TableCell align="right">Notes</TableCell>
                      <TableCell align="right">Track</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {analysis.instruments.map((inst, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box sx={{ 
                              width: 12, 
                              height: 12, 
                              borderRadius: '50%', 
                              bgcolor: COLORS[idx % COLORS.length] 
                            }} />
                            {inst.name}
                            {inst.is_percussion && (
                              <Chip label="Perc." size="small" color="secondary" />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell align="right">{inst.note_count}</TableCell>
                        <TableCell align="right">{inst.track_number}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'medium', mb: 2 }}>
              🎼 Chord Progression
            </Typography>
            
            {chordData.length > 0 ? (
              <Box sx={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chordData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis />
                    <Tooltip 
                      formatter={(value, name, props) => [
                        `${props.payload.duration.toFixed(2)}s at ${props.payload.time.toFixed(2)}s`,
                        'Chord'
                      ]}
                    />
                    <Bar dataKey="count" fill="#8884d8" />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            ) : (
              <Typography color="text.secondary">No chord data available</Typography>
            )}

            {analysis.sections?.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'medium' }}>
                  Song Structure
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {analysis.sections.map((section, idx) => (
                    <Chip
                      key={idx}
                      label={`${section.label} (${section.start_time.toFixed(1)}s)`}
                      sx={{
                        bgcolor: COLORS[idx % COLORS.length] + '40',
                        color: COLORS[idx % COLORS.length],
                        fontWeight: 'medium',
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'medium', mb: 2 }}>
              📊 Musical Characteristics
            </Typography>
            <Box sx={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="subject" />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} />
                  <Radar
                    name="Score"
                    dataKey="A"
                    stroke="#8884d8"
                    fill="#8884d8"
                    fillOpacity={0.6}
                  />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};

export default AnalysisResults;
