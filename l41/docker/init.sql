CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS fingerprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint_data BYTEA NOT NULL,
    filename VARCHAR(255) NOT NULL,
    duration_ms BIGINT,
    file_hash VARCHAR(64) UNIQUE,
    metadata JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION hamming_distance(a BYTEA, b BYTEA)
RETURNS INTEGER AS $$
DECLARE
    distance INTEGER := 0;
    i INTEGER;
    xor_val INTEGER;
BEGIN
    IF length(a) != length(b) THEN
        RETURN -1;
    END IF;
    
    FOR i IN 1..length(a) LOOP
        xor_val := get_byte(a, i - 1) # get_byte(b, i - 1);
        distance := distance + length(replace(replace(bit(xor_val)::text, '0', ''), ' ', ''));
    END LOOP;
    
    RETURN distance;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE OR REPLACE FUNCTION fingerprint_bit_positions(f BYTEA)
RETURNS INTEGER[] AS $$
DECLARE
    bits INTEGER[] := '{}';
    i INTEGER;
    j INTEGER;
    byte_val INTEGER;
    pos INTEGER;
BEGIN
    FOR i IN 0..length(f)-1 LOOP
        byte_val := get_byte(f, i);
        FOR j IN 0..7 LOOP
            IF (byte_val & (1 << j)) > 0 THEN
                pos := i * 8 + j;
                bits := array_append(bits, pos);
            END IF;
        END LOOP;
    END LOOP;
    RETURN bits;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE TABLE IF NOT EXISTS fingerprint_bits (
    fingerprint_id UUID REFERENCES fingerprints(id) ON DELETE CASCADE,
    bit_position INTEGER NOT NULL,
    PRIMARY KEY (fingerprint_id, bit_position)
);

CREATE INDEX IF NOT EXISTS idx_fingerprint_bits_position 
    ON fingerprint_bits(bit_position);

CREATE OR REPLACE FUNCTION fingerprint_to_bytea_array(f BYTEA)
RETURNS INTEGER[] AS $$
DECLARE
    result INTEGER[];
    i INTEGER;
BEGIN
    result := array_fill(0, ARRAY[length(f)]);
    FOR i IN 0..length(f)-1 LOOP
        result[i+1] := get_byte(f, i);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE INDEX IF NOT EXISTS idx_fingerprints_gist 
    ON fingerprints USING GIST (fingerprint_to_bytea_array(fingerprint_data) gist__intbig_ops);

CREATE INDEX IF NOT EXISTS idx_fingerprints_file_hash 
    ON fingerprints(file_hash);

CREATE INDEX IF NOT EXISTS idx_fingerprints_created_at 
    ON fingerprints(created_at DESC);

CREATE OR REPLACE FUNCTION find_similar_fingerprints(
    query_fingerprint BYTEA,
    max_results INTEGER DEFAULT 10,
    hamming_threshold INTEGER DEFAULT 32
)
RETURNS TABLE (
    id UUID,
    filename VARCHAR(255),
    distance INTEGER,
    similarity FLOAT
) AS $$
DECLARE
    query_len INTEGER;
BEGIN
    query_len := length(query_fingerprint) * 8;
    
    RETURN QUERY
    SELECT 
        sub.id,
        sub.filename,
        sub.dist AS distance,
        1.0 - (sub.dist::FLOAT / query_len) AS similarity
    FROM (
        SELECT 
            f.id,
            f.filename,
            hamming_distance(f.fingerprint_data, query_fingerprint) AS dist
        FROM fingerprints f
    ) sub
    WHERE sub.dist <= hamming_threshold
    ORDER BY sub.dist ASC
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_fingerprints_updated_at ON fingerprints;
CREATE TRIGGER update_fingerprints_updated_at
    BEFORE UPDATE ON fingerprints
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION insert_fingerprint_bits_trigger()
RETURNS TRIGGER AS $$
DECLARE
    bits INTEGER[];
    pos INTEGER;
BEGIN
    DELETE FROM fingerprint_bits WHERE fingerprint_id = NEW.id;
    
    bits := fingerprint_bit_positions(NEW.fingerprint_data);
    
    FOREACH pos IN ARRAY bits LOOP
        INSERT INTO fingerprint_bits (fingerprint_id, bit_position)
        VALUES (NEW.id, pos);
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS insert_fingerprint_bits ON fingerprints;
CREATE TRIGGER insert_fingerprint_bits
    AFTER INSERT ON fingerprints
    FOR EACH ROW
    EXECUTE FUNCTION insert_fingerprint_bits_trigger();

CREATE OR REPLACE FUNCTION batch_find_similar_fingerprints(
    query_fingerprints BYTEA[],
    max_results INTEGER DEFAULT 10,
    hamming_threshold INTEGER DEFAULT 32
)
RETURNS TABLE (
    query_index INTEGER,
    id UUID,
    filename VARCHAR(255),
    distance INTEGER,
    similarity FLOAT
) AS $$
DECLARE
    i INTEGER;
    q BYTEA;
    q_len INTEGER;
BEGIN
    FOR i IN 1..array_length(query_fingerprints, 1) LOOP
        q := query_fingerprints[i];
        q_len := length(q) * 8;
        
        RETURN QUERY
        SELECT 
            i AS query_index,
            sub.id,
            sub.filename,
            sub.dist AS distance,
            1.0 - (sub.dist::FLOAT / q_len) AS similarity
        FROM (
            SELECT 
                f.id,
                f.filename,
                hamming_distance(f.fingerprint_data, q) AS dist
            FROM fingerprints f
        ) sub
        WHERE sub.dist <= hamming_threshold
        ORDER BY sub.dist ASC
        LIMIT max_results;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;
