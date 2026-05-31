package fingerprint

import (
	"context"
	"fmt"

	"fingerprint-service/internal/storage"
	pb "fingerprint-service/proto/fingerprintpb"
)

type Service struct {
	pb.UnimplementedFingerprintServiceServer
	storage storage.Storage
}

func NewService(storage storage.Storage) *Service {
	return &Service{storage: storage}
}

func (s *Service) StoreFingerprint(ctx context.Context, req *pb.StoreFingerprintRequest) (*pb.StoreFingerprintResponse, error) {
	if req.Fingerprint == nil {
		return &pb.StoreFingerprintResponse{
			Success: false,
			Message: "fingerprint is required",
		}, nil
	}

	if req.Fingerprint.Data == nil || len(req.Fingerprint.Data) == 0 {
		return &pb.StoreFingerprintResponse{
			Success: false,
			Message: "fingerprint data is required",
		}, nil
	}

	fp := &storage.Fingerprint{
		Data:        req.Fingerprint.Data,
		Filename:    req.Fingerprint.Filename,
		DurationMs:  req.Fingerprint.DurationMs,
		FileHash:    req.Fingerprint.FileHash,
		Metadata:    req.Fingerprint.Metadata,
	}

	id, err := s.storage.Store(ctx, fp)
	if err != nil {
		return nil, fmt.Errorf("failed to store: %w", err)
	}

	return &pb.StoreFingerprintResponse{
		Id:      id,
		Success: true,
		Message: "stored successfully",
	}, nil
}

func (s *Service) QueryFingerprint(ctx context.Context, req *pb.QueryFingerprintRequest) (*pb.QueryFingerprintResponse, error) {
	if req.FingerprintData == nil || len(req.FingerprintData) == 0 {
		return &pb.QueryFingerprintResponse{
			TotalCount:   0,
		}, nil
	}

	threshold := int(req.HammingThreshold)
	if threshold <= 0 {
		threshold = 32
	}

	matches, err := s.storage.Query(ctx, req.FingerprintData, int(req.MaxResults), threshold)
	if err != nil {
		return nil, fmt.Errorf("failed to query: %w", err)
	}

	pbMatches := make([]*pb.MatchResult, len(matches))
	for i, m := range matches {
		pbMatches[i] = &pb.MatchResult{
			Id:              m.ID,
			Filename:         m.Filename,
			HammingDistance: int32(m.Distance),
			SimilarityScore: float32(m.Similarity),
			Metadata:         m.Metadata,
		}
	}

	return &pb.QueryFingerprintResponse{
		Matches:       pbMatches,
		TotalCount:    int32(len(pbMatches)),
		ThresholdUsed: int32(threshold),
	}, nil
}

func (s *Service) BatchStoreFingerprints(ctx context.Context, req *pb.BatchStoreRequest) (*pb.BatchStoreResponse, error) {
	if req.Fingerprints == nil || len(req.Fingerprints) == 0 {
		return &pb.BatchStoreResponse{
			SuccessCount: 0,
			FailedCount:  0,
		}, nil
	}

	ids := make([]string, 0, len(req.Fingerprints))
	successCount := 0
	failedCount := 0

	for _, fp := range req.Fingerprints {
		stored := &storage.Fingerprint{
			Data:        fp.Data,
			Filename:    fp.Filename,
			DurationMs:  fp.DurationMs,
			FileHash:    fp.FileHash,
			Metadata:    fp.Metadata,
		}

		id, err := s.storage.Store(ctx, stored)
		if err != nil {
			failedCount++
			continue
		}

		ids = append(ids, id)
		successCount++
	}

	return &pb.BatchStoreResponse{
		Ids:          ids,
		SuccessCount: int32(successCount),
		FailedCount:  int32(failedCount),
	}, nil
}

func (s *Service) GetFingerprint(ctx context.Context, req *pb.GetFingerprintRequest) (*pb.GetFingerprintResponse, error) {
	fp, err := s.storage.Get(ctx, req.Id)
	if err != nil {
		return nil, fmt.Errorf("failed to get: %w", err)
	}

	return &pb.GetFingerprintResponse{
		Id: fp.ID,
		Fingerprint: &pb.Fingerprint{
			Data:        fp.Data,
			Filename:    fp.Filename,
			DurationMs:  fp.DurationMs,
			FileHash:    fp.FileHash,
			Metadata:    fp.Metadata,
		},
		CreatedAt: fp.CreatedAt.Unix(),
	}, nil
}

func (s *Service) DeleteFingerprint(ctx context.Context, req *pb.DeleteFingerprintRequest) (*pb.DeleteFingerprintResponse, error) {
	err := s.storage.Delete(ctx, req.Id)
	if err != nil {
		return &pb.DeleteFingerprintResponse{
			Success: false,
			Message: err.Error(),
		}, nil
	}

	return &pb.DeleteFingerprintResponse{
		Success: true,
		Message: "deleted successfully",
	}, nil
}

func (s *Service) ListFingerprints(ctx context.Context, req *pb.ListFingerprintsRequest) (*pb.ListFingerprintsResponse, error) {
	fps, total, err := s.storage.List(ctx, int(req.Page), int(req.PageSize))
	if err != nil {
		return nil, fmt.Errorf("failed to list: %w", err)
	}

	pbFps := make([]*pb.FingerprintInfo, len(fps))
	for i, fp := range fps {
		pbFps[i] = &pb.FingerprintInfo{
			Id:        fp.ID,
			Filename:    fp.Filename,
			DurationMs:  fp.DurationMs,
			CreatedAt: fp.CreatedAt.Unix(),
		}
	}

	return &pb.ListFingerprintsResponse{
		Fingerprints: pbFps,
		TotalCount: int32(total),
		Page:       req.Page,
		PageSize:   req.PageSize,
	}, nil
}

func (s *Service) BatchQueryFingerprints(ctx context.Context, req *pb.BatchQueryRequest) (*pb.BatchQueryResponse, error) {
	if len(req.FingerprintData) == 0 {
		return &pb.BatchQueryResponse{
			TotalQueries: 0,
			TotalMatches: 0,
		}, nil
	}

	if len(req.FingerprintData) > 100 {
		return nil, fmt.Errorf("maximum 100 fingerprints per batch query")
	}

	threshold := int(req.HammingThreshold)
	if threshold <= 0 {
		threshold = 32
	}

	maxResults := int(req.MaxResultsPerQuery)
	if maxResults <= 0 {
		maxResults = 10
	}

	batchResults, err := s.storage.BatchQuery(ctx, req.FingerprintData, maxResults, threshold)
	if err != nil {
		return nil, fmt.Errorf("failed to batch query: %w", err)
	}

	pbResults := make([]*pb.QueryResult, len(batchResults))
	totalMatches := 0

	for i, matches := range batchResults {
		pbMatches := make([]*pb.MatchResult, len(matches))
		for j, m := range matches {
			pbMatches[j] = &pb.MatchResult{
				Id:              m.ID,
				Filename:         m.Filename,
				HammingDistance: int32(m.Distance),
				SimilarityScore: float32(m.Similarity),
				Metadata:         m.Metadata,
			}
		}
		pbResults[i] = &pb.QueryResult{
			QueryFingerprint: req.FingerprintData[i],
			Matches:           pbMatches,
		}
		totalMatches += len(pbMatches)
	}

	return &pb.BatchQueryResponse{
		Results:      pbResults,
		TotalQueries: int32(len(req.FingerprintData)),
		TotalMatches: int32(totalMatches),
	}, nil
}
