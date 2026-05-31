package elasticsearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/elastic/go-elasticsearch/v8"
	"github.com/elastic/go-elasticsearch/v8/esapi"
)

const (
	IndexName = "sequence_signatures"
)

type Client struct {
	es *elasticsearch.Client
}

type SequenceDocument struct {
	ChunkID       string   `json:"chunk_id"`
	TaskID        string   `json:"task_id"`
	Header        string   `json:"header"`
	Signature     []uint64 `json:"signature"`
	SequenceLen   int      `json:"sequence_len"`
}

func NewClient(url string) (*Client, error) {
	cfg := elasticsearch.Config{
		Addresses: []string{url},
	}

	es, err := elasticsearch.NewClient(cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create Elasticsearch client: %w", err)
	}

	client := &Client{es: es}

	if err := client.ensureIndex(); err != nil {
		return nil, err
	}

	return client, nil
}

func (c *Client) ensureIndex() error {
	mapping := `{
		"mappings": {
			"properties": {
				"chunk_id": {"type": "keyword"},
				"task_id": {"type": "keyword"},
				"header": {"type": "text"},
				"signature": {"type": "dense_vector", "dims": 128},
				"sequence_len": {"type": "integer"}
			}
		}
	}`

	req := esapi.IndicesCreateRequest{
		Index: IndexName,
		Body:  strings.NewReader(mapping),
	}

	res, err := req.Do(context.Background(), c.es)
	if err != nil {
		return fmt.Errorf("failed to create index: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() && res.StatusCode != 400 {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("index creation error: %s", string(body))
	}

	return nil
}

func (c *Client) IndexDocument(doc SequenceDocument) error {
	body, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("failed to marshal document: %w", err)
	}

	req := esapi.IndexRequest{
		Index:      IndexName,
		DocumentID: doc.ChunkID,
		Body:       bytes.NewReader(body),
		Refresh:    "true",
	}

	res, err := req.Do(context.Background(), c.es)
	if err != nil {
		return fmt.Errorf("failed to index document: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("index error: %s", string(body))
	}

	return nil
}

func (c *Client) BulkIndex(docs []SequenceDocument) error {
	if len(docs) == 0 {
		return nil
	}

	var buf bytes.Buffer
	for _, doc := range docs {
		meta := fmt.Sprintf(`{"index": {"_id": "%s"}}`, doc.ChunkID)
		buf.WriteString(meta + "\n")

		body, err := json.Marshal(doc)
		if err != nil {
			return fmt.Errorf("failed to marshal document: %w", err)
		}
		buf.Write(body)
		buf.WriteString("\n")
	}

	req := esapi.BulkRequest{
		Index:   IndexName,
		Body:    bytes.NewReader(buf.Bytes()),
		Refresh: "true",
	}

	res, err := req.Do(context.Background(), c.es)
	if err != nil {
		return fmt.Errorf("failed to bulk index: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("bulk index error: %s", string(body))
	}

	return nil
}

func (c *Client) SearchSimilar(taskID string, signature []uint64, minScore float64, limit int) ([]string, error) {
	query := map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"filter": map[string]interface{}{
					"term": map[string]string{
						"task_id": taskID,
					},
				},
				"must": map[string]interface{}{
					"script_score": map[string]interface{}{
						"query": map[string]interface{}{
							"match_all": map[string]interface{}{},
						},
						"script": map[string]interface{}{
							"source": "cosineSimilarity(params.query_vector, 'signature') + 1.0",
							"params": map[string]interface{}{
								"query_vector": signature,
							},
						},
					},
				},
			},
		},
		"min_score": minScore,
		"size":      limit,
	}

	body, err := json.Marshal(query)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal query: %w", err)
	}

	req := esapi.SearchRequest{
		Index: []string{IndexName},
		Body:  bytes.NewReader(body),
	}

	res, err := req.Do(context.Background(), c.es)
	if err != nil {
		return nil, fmt.Errorf("failed to search: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		respBody, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("search error: %s", string(respBody))
	}

	var result struct {
		Hits struct {
			Hits []struct {
				ID     string  `json:"_id"`
				Score  float64 `json:"_score"`
			} `json:"hits"`
		} `json:"hits"`
	}

	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	chunkIDs := make([]string, 0, len(result.Hits.Hits))
	for _, hit := range result.Hits.Hits {
		chunkIDs = append(chunkIDs, hit.ID)
	}

	return chunkIDs, nil
}

func (c *Client) DeleteByTaskID(taskID string) error {
	query := map[string]interface{}{
		"query": map[string]interface{}{
			"term": map[string]string{
				"task_id": taskID,
			},
		},
	}

	body, err := json.Marshal(query)
	if err != nil {
		return fmt.Errorf("failed to marshal query: %w", err)
	}

	refresh := true
	req := esapi.DeleteByQueryRequest{
		Index:   []string{IndexName},
		Body:    bytes.NewReader(body),
		Refresh: &refresh,
	}

	res, err := req.Do(context.Background(), c.es)
	if err != nil {
		return fmt.Errorf("failed to delete by query: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		respBody, _ := io.ReadAll(res.Body)
		return fmt.Errorf("delete error: %s", string(respBody))
	}

	return nil
}

func (c *Client) GetDocument(chunkID string) (*SequenceDocument, error) {
	req := esapi.GetRequest{
		Index:      IndexName,
		DocumentID: chunkID,
	}

	res, err := req.Do(context.Background(), c.es)
	if err != nil {
		return nil, fmt.Errorf("failed to get document: %w", err)
	}
	defer res.Body.Close()

	if res.IsError() {
		if res.StatusCode == 404 {
			return nil, nil
		}
		body, _ := io.ReadAll(res.Body)
		return nil, fmt.Errorf("get error: %s", string(body))
	}

	var result struct {
		Source SequenceDocument `json:"_source"`
	}

	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result.Source, nil
}

func (c *Client) Close() error {
	return nil
}
