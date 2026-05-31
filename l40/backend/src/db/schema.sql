DROP TABLE IF EXISTS inspection_routes CASCADE;
DROP TABLE IF EXISTS factory_graph_edges CASCADE;
DROP TABLE IF EXISTS factory_graph_nodes CASCADE;
DROP TABLE IF EXISTS defects CASCADE;
DROP TABLE IF EXISTS inspections CASCADE;
DROP TABLE IF EXISTS sensor_data CASCADE;
DROP TABLE IF EXISTS spatial_anchors CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;

CREATE TABLE equipment (
  id SERIAL PRIMARY KEY,
  qr_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  model_path TEXT,
  location VARCHAR(255),
  specs JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE spatial_anchors (
  id SERIAL PRIMARY KEY,
  anchor_id VARCHAR(255) UNIQUE NOT NULL,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  position JSONB NOT NULL DEFAULT '{}',
  rotation JSONB NOT NULL DEFAULT '{}',
  creator VARCHAR(255),
  shared BOOLEAN DEFAULT false,
  anchor_data TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE inspections (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  inspector VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'in_progress',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE defects (
  id SERIAL PRIMARY KEY,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  spatial_anchor_id INTEGER REFERENCES spatial_anchors(id) ON DELETE SET NULL,
  position JSONB NOT NULL,
  photo_url TEXT,
  voice_url TEXT,
  description TEXT,
  severity VARCHAR(20) DEFAULT 'medium',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE sensor_data (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  sensor_type VARCHAR(50) NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit VARCHAR(20),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_inspections_equipment ON inspections(equipment_id);
CREATE INDEX idx_defects_inspection ON defects(inspection_id);
CREATE INDEX idx_defects_spatial_anchor ON defects(spatial_anchor_id);
CREATE INDEX idx_sensor_data_equipment ON sensor_data(equipment_id);
CREATE INDEX idx_sensor_data_timestamp ON sensor_data(timestamp);
CREATE INDEX idx_sensor_data_type ON sensor_data(sensor_type);
CREATE INDEX idx_equipment_qr ON equipment(qr_code);
CREATE INDEX idx_spatial_anchors_anchor_id ON spatial_anchors(anchor_id);
CREATE INDEX idx_spatial_anchors_equipment ON spatial_anchors(equipment_id);
CREATE INDEX idx_spatial_anchors_created_at ON spatial_anchors(created_at);
CREATE INDEX idx_spatial_anchors_expires_at ON spatial_anchors(expires_at);

CREATE TABLE factory_graph_nodes (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  equipment_name VARCHAR(255),
  position_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  position_z DOUBLE PRECISION NOT NULL DEFAULT 0,
  priority INTEGER DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
  floor INTEGER DEFAULT 1,
  zone VARCHAR(100)
);

CREATE TABLE factory_graph_edges (
  id SERIAL PRIMARY KEY,
  from_node_id INTEGER NOT NULL REFERENCES factory_graph_nodes(id) ON DELETE CASCADE,
  to_node_id INTEGER NOT NULL REFERENCES factory_graph_nodes(id) ON DELETE CASCADE,
  distance DOUBLE PRECISION NOT NULL,
  walkable BOOLEAN DEFAULT true,
  is_bidirectional BOOLEAN DEFAULT true,
  blocked_reason TEXT
);

CREATE TABLE inspection_routes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  path_data JSONB NOT NULL DEFAULT '[]',
  total_distance DOUBLE PRECISION DEFAULT 0,
  estimated_time DOUBLE PRECISION DEFAULT 0,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_graph_nodes_equipment ON factory_graph_nodes(equipment_id);
CREATE INDEX idx_graph_edges_from ON factory_graph_edges(from_node_id);
CREATE INDEX idx_graph_edges_to ON factory_graph_edges(to_node_id);
CREATE INDEX idx_inspection_routes_created_at ON inspection_routes(created_at);

INSERT INTO equipment (qr_code, name, model_path, location, specs) VALUES
  ('EQ-001', 'CNC Milling Machine X500', '/models/cnc_x500.glb', 'Workshop A - Bay 1',
   '{"power": "15kW", "spindle_speed": "12000 RPM", "table_size": "1200x500mm", "weight": "3500kg"}'),
  ('EQ-002', 'Industrial Robot Arm R2000', '/models/robot_r2000.glb', 'Assembly Line B - Station 3',
   '{"axes": 6, "payload": "200kg", "reach": "2600mm", "repeatability": "±0.05mm"}'),
  ('EQ-003', 'Hydraulic Press HP-300', '/models/hp300.glb', 'Workshop C - Bay 7',
   '{"force": "300 tons", "stroke": "500mm", "table_size": "1500x1200mm", "operating_pressure": "250 bar"}');

INSERT INTO factory_graph_nodes (equipment_id, equipment_name, position_x, position_y, position_z, priority, floor, zone) VALUES
  (1, 'CNC Milling Machine X500', -5, 0, -10, 5, 1, 'Workshop A'),
  (2, 'Industrial Robot Arm R2000', 0, 0, -5, 4, 1, 'Assembly Line B'),
  (3, 'Hydraulic Press HP-300', 5, 0, -10, 3, 1, 'Workshop C');

INSERT INTO factory_graph_edges (from_node_id, to_node_id, distance, walkable, is_bidirectional) VALUES
  (1, 2, SQRT(POWER(0 - (-5), 2) + POWER(-5 - (-10), 2)), true, true),
  (2, 1, SQRT(POWER(0 - (-5), 2) + POWER(-5 - (-10), 2)), true, false),
  (2, 3, SQRT(POWER(5 - 0, 2) + POWER(-10 - (-5), 2)), true, true),
  (3, 2, SQRT(POWER(5 - 0, 2) + POWER(-10 - (-5), 2)), true, false),
  (1, 3, SQRT(POWER(5 - (-5), 2) + POWER(-10 - (-10), 2)), true, true),
  (3, 1, SQRT(POWER(5 - (-5), 2) + POWER(-10 - (-10), 2)), true, false);
