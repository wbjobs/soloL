package api

import (
	"context"
	"crypto-proxy/pkg/crypto"
	"crypto-proxy/pkg/rotation"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
)

type APIServer struct {
	cryptoEngine  *crypto.RC4Engine
	metadataMgr   *crypto.MetadataManager
	arbitrator    *rotation.KeyRotationArbitrator
	server        *http.Server
	addr          string
}

type KeyResponse struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	CreatedAt int64  `json:"created_at"`
	Active    bool   `json:"active"`
}

type ColumnConfigRequest struct {
	TableSchema string `json:"table_schema"`
	TableName   string `json:"table_name"`
	ColumnName  string `json:"column_name"`
	Enabled     bool   `json:"enabled"`
	KeyVersion  int    `json:"key_version"`
}

type ColumnConfigResponse struct {
	TableSchema string `json:"table_schema"`
	TableName   string `json:"table_name"`
	ColumnName  string `json:"column_name"`
	Enabled     bool   `json:"enabled"`
	KeyVersion  int    `json:"key_version"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"updated_at"`
}

type RotationRequest struct {
	Force bool `json:"force"`
}

type RotationResponse struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

type RotationStatusResponse struct {
	RequestID   string  `json:"request_id"`
	Status      string  `json:"status"`
	Phase       string  `json:"phase"`
	CurrentKey  int     `json:"current_key"`
	NewKey      int     `json:"new_key"`
	Progress    float64 `json:"progress"`
	StartedAt   int64   `json:"started_at"`
	CompletedAt int64   `json:"completed_at"`
	Error       string  `json:"error,omitempty"`
}

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp int64  `json:"timestamp"`
}

type StatsResponse struct {
	ActiveKeyVersions int     `json:"active_key_versions"`
	LatestKeyVersion  int     `json:"latest_key_version"`
	EncryptedColumns  int     `json:"encrypted_columns"`
	RotationInProgress bool   `json:"rotation_in_progress"`
	Uptime            float64 `json:"uptime_seconds"`
}

func NewAPIServer(
	addr string,
	cryptoEngine *crypto.RC4Engine,
	metadataMgr *crypto.MetadataManager,
	arbitrator *rotation.KeyRotationArbitrator,
) *APIServer {
	return &APIServer{
		cryptoEngine: cryptoEngine,
		metadataMgr:  metadataMgr,
		arbitrator:   arbitrator,
		addr:         addr,
	}
}

func (s *APIServer) Start() error {
	r := mux.NewRouter()

	apiV1 := r.PathPrefix("/api/v1").Subrouter()

	apiV1.HandleFunc("/health", s.handleHealth).Methods("GET")
	apiV1.HandleFunc("/stats", s.handleStats).Methods("GET")

	keys := apiV1.PathPrefix("/keys").Subrouter()
	keys.HandleFunc("", s.handleListKeys).Methods("GET")
	keys.HandleFunc("", s.handleAddKey).Methods("POST")
	keys.HandleFunc("/{version}", s.handleGetKey).Methods("GET")
	keys.HandleFunc("/{version}", s.handleDeleteKey).Methods("DELETE")
	keys.HandleFunc("/rotate", s.handleRotateKey).Methods("POST")

	columns := apiV1.PathPrefix("/columns").Subrouter()
	columns.HandleFunc("", s.handleListColumns).Methods("GET")
	columns.HandleFunc("", s.handleAddColumn).Methods("POST")
	columns.HandleFunc("/{schema}/{table}/{column}", s.handleGetColumn).Methods("GET")
	columns.HandleFunc("/{schema}/{table}/{column}", s.handleUpdateColumn).Methods("PUT")
	columns.HandleFunc("/{schema}/{table}/{column}", s.handleDeleteColumn).Methods("DELETE")

	rotation := apiV1.PathPrefix("/rotation").Subrouter()
	rotation.HandleFunc("", s.handleRotationStatus).Methods("GET")
	rotation.HandleFunc("", s.handleRequestRotation).Methods("POST")

	s.server = &http.Server{
		Addr:    s.addr,
		Handler: r,
	}

	go func() {
		s.server.ListenAndServe()
	}()

	return nil
}

func (s *APIServer) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return s.server.Shutdown(ctx)
}

func (s *APIServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(HealthResponse{
		Status:    "ok",
		Timestamp: time.Now().Unix(),
	})
}

func (s *APIServer) handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	
	versions := s.cryptoEngine.GetActiveVersions()
	columns := s.metadataMgr.GetAllColumns()
	encryptedCount := 0
	for _, c := range columns {
		if c.Enabled {
			encryptedCount++
		}
	}
	
	json.NewEncoder(w).Encode(StatsResponse{
		ActiveKeyVersions:  len(versions),
		LatestKeyVersion:   s.cryptoEngine.GetLatestVersion(),
		EncryptedColumns:   encryptedCount,
		RotationInProgress: s.arbitrator.IsRotationInProgress(),
		Uptime:             0,
	})
}

func (s *APIServer) handleListKeys(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	versions := s.cryptoEngine.GetActiveVersions()
	response := make([]KeyResponse, 0, len(versions))
	for _, v := range versions {
		response = append(response, KeyResponse{
			Version: v,
			Active:  true,
		})
	}
	json.NewEncoder(w).Encode(response)
}

func (s *APIServer) handleAddKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string `json:"id"`
		Version  int    `json:"version"`
		KeyBytes string `json:"key_bytes"`
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	keyBytes := []byte(req.KeyBytes)
	if err := s.cryptoEngine.AddKey(req.ID, req.Version, keyBytes); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(KeyResponse{
		ID:      req.ID,
		Version: req.Version,
		Active:  true,
	})
}

func (s *APIServer) handleGetKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	versionStr := vars["version"]
	version, err := strconv.Atoi(versionStr)
	if err != nil {
		http.Error(w, "invalid version", http.StatusBadRequest)
		return
	}

	versions := s.cryptoEngine.GetActiveVersions()
	found := false
	for _, v := range versions {
		if v == version {
			found = true
			break
		}
	}

	if !found {
		http.Error(w, "key not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(KeyResponse{
		Version: version,
		Active:  true,
	})
}

func (s *APIServer) handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	versionStr := vars["version"]
	version, err := strconv.Atoi(versionStr)
	if err != nil {
		http.Error(w, "invalid version", http.StatusBadRequest)
		return
	}

	if !s.cryptoEngine.RemoveKey(version) {
		http.Error(w, "key not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *APIServer) handleRotateKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID       string `json:"id"`
		KeyBytes string `json:"key_bytes"`
	}
	
	json.NewDecoder(r.Body).Decode(&req)

	var newVersion int
	var err error
	
	if req.KeyBytes != "" {
		newVersion, err = s.cryptoEngine.RotateKey(req.ID, []byte(req.KeyBytes))
	} else {
		keyID, keyBytes, genErr := rotation.GenerateNewKey()
		if genErr != nil {
			http.Error(w, genErr.Error(), http.StatusInternalServerError)
			return
		}
		newVersion, err = s.cryptoEngine.RotateKey(keyID, keyBytes)
	}

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(KeyResponse{
		Version: newVersion,
		Active:  true,
	})
}

func (s *APIServer) handleListColumns(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	columns := s.metadataMgr.GetAllColumns()
	response := make([]ColumnConfigResponse, len(columns))
	for i, c := range columns {
		response[i] = ColumnConfigResponse{
			TableSchema: c.TableSchema,
			TableName:   c.TableName,
			ColumnName:  c.ColumnName,
			Enabled:     c.Enabled,
			KeyVersion:  c.KeyVersion,
			CreatedAt:   c.CreatedAt,
			UpdatedAt:   c.UpdatedAt,
		}
	}
	json.NewEncoder(w).Encode(response)
}

func (s *APIServer) handleAddColumn(w http.ResponseWriter, r *http.Request) {
	var req ColumnConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := time.Now().Unix()
	config := &crypto.ColumnEncryptionConfig{
		TableSchema: req.TableSchema,
		TableName:   req.TableName,
		ColumnName:  req.ColumnName,
		Enabled:     req.Enabled,
		KeyVersion:  req.KeyVersion,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	s.metadataMgr.AddColumn(config)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(ColumnConfigResponse{
		TableSchema: config.TableSchema,
		TableName:   config.TableName,
		ColumnName:  config.ColumnName,
		Enabled:     config.Enabled,
		KeyVersion:  config.KeyVersion,
		CreatedAt:   config.CreatedAt,
		UpdatedAt:   config.UpdatedAt,
	})
}

func (s *APIServer) handleGetColumn(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	schema := vars["schema"]
	table := vars["table"]
	column := vars["column"]

	config, exists := s.metadataMgr.GetColumn(schema, table, column)
	if !exists {
		http.Error(w, "column not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ColumnConfigResponse{
		TableSchema: config.TableSchema,
		TableName:   config.TableName,
		ColumnName:  config.ColumnName,
		Enabled:     config.Enabled,
		KeyVersion:  config.KeyVersion,
		CreatedAt:   config.CreatedAt,
		UpdatedAt:   config.UpdatedAt,
	})
}

func (s *APIServer) handleUpdateColumn(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	schema := vars["schema"]
	table := vars["table"]
	column := vars["column"]

	var req ColumnConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	config, exists := s.metadataMgr.GetColumn(schema, table, column)
	if !exists {
		http.Error(w, "column not found", http.StatusNotFound)
		return
	}

	config.Enabled = req.Enabled
	config.KeyVersion = req.KeyVersion
	config.UpdatedAt = time.Now().Unix()

	s.metadataMgr.AddColumn(config)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ColumnConfigResponse{
		TableSchema: config.TableSchema,
		TableName:   config.TableName,
		ColumnName:  config.ColumnName,
		Enabled:     config.Enabled,
		KeyVersion:  config.KeyVersion,
		CreatedAt:   config.CreatedAt,
		UpdatedAt:   config.UpdatedAt,
	})
}

func (s *APIServer) handleDeleteColumn(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	schema := vars["schema"]
	table := vars["table"]
	column := vars["column"]

	if !s.metadataMgr.RemoveColumn(schema, table, column) {
		http.Error(w, "column not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *APIServer) handleRotationStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	status := s.arbitrator.GetStatus()
	json.NewEncoder(w).Encode(RotationStatusResponse{
		RequestID:   status.RequestID,
		Status:      status.Status.String(),
		Phase:       status.Phase.String(),
		CurrentKey:  status.CurrentKey,
		NewKey:      status.NewKey,
		Progress:    status.Progress,
		StartedAt:   status.StartedAt,
		CompletedAt: status.CompletedAt,
		Error:       status.Error,
	})
}

func (s *APIServer) handleRequestRotation(w http.ResponseWriter, r *http.Request) {
	var req RotationRequest
	json.NewDecoder(r.Body).Decode(&req)

	requestID, err := s.arbitrator.ForceRotate()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(RotationResponse{
		RequestID: requestID,
		Status:    "accepted",
	})
}
