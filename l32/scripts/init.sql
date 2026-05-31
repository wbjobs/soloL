CREATE TABLE IF NOT EXISTS alignment_tasks (
    task_id UUID PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    total_chunks INTEGER NOT NULL,
    completed_chunks INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sequence_chunks (
    chunk_id UUID PRIMARY KEY,
    task_id UUID REFERENCES alignment_tasks(task_id),
    chunk_index INTEGER NOT NULL,
    sequence_header TEXT NOT NULL,
    sequence_data TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alignment_results (
    id SERIAL PRIMARY KEY,
    task_id UUID REFERENCES alignment_tasks(task_id),
    chunk_a_id UUID REFERENCES sequence_chunks(chunk_id),
    chunk_b_id UUID REFERENCES sequence_chunks(chunk_id),
    similarity_score FLOAT NOT NULL,
    alignment_length INTEGER,
    identity_percentage FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_results_task_id ON alignment_results(task_id);
CREATE INDEX IF NOT EXISTS idx_results_score ON alignment_results(similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON alignment_tasks(status);
