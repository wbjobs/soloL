package sync

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

type SyncOperation string

const (
	OpKeyAdded      SyncOperation = "KEY_ADDED"
	OpKeyRemoved    SyncOperation = "KEY_REMOVED"
	OpKeyRotated    SyncOperation = "KEY_ROTATED"
	OpColumnAdded   SyncOperation = "COLUMN_ADDED"
	OpColumnRemoved SyncOperation = "COLUMN_REMOVED"
	OpColumnUpdated SyncOperation = "COLUMN_UPDATED"
	OpConfigChanged SyncOperation = "CONFIG_CHANGED"
)

type SyncMessage struct {
	ID          string
	Timestamp   time.Time
	DCID        string
	Operation   SyncOperation
	EntityType  string
	EntityID    string
	Payload     map[string]interface{}
	Version     int64
	Checksum    string
}

type KafkaConfig struct {
	Brokers     []string
	Topic       string
	GroupID     string
	DCID        string
}

type MessageHandler func(msg *SyncMessage) error

type MockKafkaProducer struct {
	mu        sync.Mutex
	messages  []*SyncMessage
	dcid      string
	consumers []*MockKafkaConsumer
}

type MockKafkaConsumer struct {
	mu          sync.Mutex
	dcid        string
	handler     MessageHandler
	messages    chan *SyncMessage
	stopChan    chan struct{}
	wg          sync.WaitGroup
	running     bool
	lastOffset  int64
}

func NewMockKafkaProducer(dcid string) *MockKafkaProducer {
	return &MockKafkaProducer{
		messages:  make([]*SyncMessage, 0, 1000),
		dcid:      dcid,
		consumers: make([]*MockKafkaConsumer, 0),
	}
}

func (p *MockKafkaProducer) RegisterConsumer(c *MockKafkaConsumer) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.consumers = append(p.consumers, c)
}

func (p *MockKafkaProducer) Send(msg *SyncMessage) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	msg.DCID = p.dcid
	msg.Timestamp = time.Now()
	msg.ID = fmt.Sprintf("%s-%d", p.dcid, len(p.messages))
	p.messages = append(p.messages, msg)

	for _, c := range p.consumers {
		c.Deliver(msg)
	}

	return nil
}

func (p *MockKafkaProducer) GetMessages() []*SyncMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := make([]*SyncMessage, len(p.messages))
	copy(result, p.messages)
	return result
}

func (p *MockKafkaProducer) GetMessageCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.messages)
}

func (p *MockKafkaProducer) ClearMessages() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.messages = p.messages[:0]
}

func NewMockKafkaConsumer(dcid string, handler MessageHandler) *MockKafkaConsumer {
	return &MockKafkaConsumer{
		dcid:     dcid,
		handler:  handler,
		messages: make(chan *SyncMessage, 1000),
		stopChan: make(chan struct{}),
	}
}

func (c *MockKafkaConsumer) Deliver(msg *SyncMessage) {
	select {
	case c.messages <- msg:
	default:
	}
}

func (c *MockKafkaConsumer) Start() {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return
	}
	c.running = true
	c.mu.Unlock()

	c.wg.Add(1)
	go c.processLoop()
}

func (c *MockKafkaConsumer) processLoop() {
	defer c.wg.Done()

	for {
		select {
		case msg := <-c.messages:
			if c.handler != nil {
				c.handler(msg)
			}
			c.mu.Lock()
			c.lastOffset++
			c.mu.Unlock()
		case <-c.stopChan:
			return
		}
	}
}

func (c *MockKafkaConsumer) Stop() {
	c.mu.Lock()
	if !c.running {
		c.mu.Unlock()
		return
	}
	c.running = false
	c.mu.Unlock()

	close(c.stopChan)
	c.wg.Wait()
}

func (c *MockKafkaConsumer) GetLastOffset() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastOffset
}

type DCSyncManager struct {
	mu          sync.Mutex
	dcid        string
	producer    *MockKafkaProducer
	consumer    *MockKafkaConsumer
	peerDCs     map[string]bool
	state       map[string]interface{}
	version     int64
	callbacks   map[SyncOperation][]MessageHandler
	isPrimary   bool
}

func NewDCSyncManager(dcid string, isPrimary bool) *DCSyncManager {
	producer := NewMockKafkaProducer(dcid)
	manager := &DCSyncManager{
		dcid:      dcid,
		producer:  producer,
		peerDCs:   make(map[string]bool),
		state:     make(map[string]interface{}),
		version:   0,
		callbacks: make(map[SyncOperation][]MessageHandler),
		isPrimary: isPrimary,
	}

	consumer := NewMockKafkaConsumer(dcid, manager.handleMessage)
	manager.consumer = consumer
	producer.RegisterConsumer(consumer)
	consumer.Start()

	return manager
}

func (m *DCSyncManager) handleMessage(msg *SyncMessage) error {
	m.mu.Lock()
	isNewer := msg.Version > m.version
	if isNewer {
		m.version = msg.Version
		m.state[msg.EntityID] = msg.Payload
	}
	callbacks := m.callbacks[msg.Operation]
	m.mu.Unlock()

	for _, cb := range callbacks {
		cb(msg)
	}

	return nil
}

func (m *DCSyncManager) OnOperation(op SyncOperation, handler MessageHandler) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.callbacks[op] = append(m.callbacks[op], handler)
}

func (m *DCSyncManager) PublishKeyAdded(keyID string, version int, keyMetadata map[string]interface{}) error {
	return m.publish(OpKeyAdded, "key", keyID, keyMetadata)
}

func (m *DCSyncManager) PublishKeyRemoved(keyID string) error {
	return m.publish(OpKeyRemoved, "key", keyID, nil)
}

func (m *DCSyncManager) PublishKeyRotated(oldVersion, newVersion int, keyID string) error {
	payload := map[string]interface{}{
		"old_version": oldVersion,
		"new_version": newVersion,
	}
	return m.publish(OpKeyRotated, "key", keyID, payload)
}

func (m *DCSyncManager) PublishColumnAdded(tableName, columnName string, config map[string]interface{}) error {
	entityID := fmt.Sprintf("%s.%s", tableName, columnName)
	return m.publish(OpColumnAdded, "column", entityID, config)
}

func (m *DCSyncManager) PublishColumnRemoved(tableName, columnName string) error {
	entityID := fmt.Sprintf("%s.%s", tableName, columnName)
	return m.publish(OpColumnRemoved, "column", entityID, nil)
}

func (m *DCSyncManager) PublishColumnUpdated(tableName, columnName string, config map[string]interface{}) error {
	entityID := fmt.Sprintf("%s.%s", tableName, columnName)
	return m.publish(OpColumnUpdated, "column", entityID, config)
}

func (m *DCSyncManager) publish(op SyncOperation, entityType, entityID string, payload map[string]interface{}) error {
	m.mu.Lock()
	m.version++
	version := m.version
	m.state[entityID] = payload
	m.mu.Unlock()

	msg := &SyncMessage{
		Operation:  op,
		EntityType: entityType,
		EntityID:   entityID,
		Payload:    payload,
		Version:    version,
	}

	return m.producer.Send(msg)
}

func (m *DCSyncManager) AddPeerDC(peerDCID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.peerDCs[peerDCID] = true
}

func (m *DCSyncManager) RemovePeerDC(peerDCID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.peerDCs, peerDCID)
}

func (m *DCSyncManager) GetPeerDCs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]string, 0, len(m.peerDCs))
	for dcid := range m.peerDCs {
		result = append(result, dcid)
	}
	return result
}

func (m *DCSyncManager) GetVersion() int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.version
}

func (m *DCSyncManager) GetState(entityID string) (interface{}, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	val, exists := m.state[entityID]
	return val, exists
}

func (m *DCSyncManager) Start() {
	m.consumer.Start()
}

func (m *DCSyncManager) Stop() {
	m.consumer.Stop()
}

func (m *DCSyncManager) GetProducer() *MockKafkaProducer {
	return m.producer
}

func (m *DCSyncManager) GetDCID() string {
	return m.dcid
}

func (m *DCSyncManager) IsPrimary() bool {
	return m.isPrimary
}

func SerializeMessage(msg *SyncMessage) ([]byte, error) {
	return json.Marshal(msg)
}

func DeserializeMessage(data []byte) (*SyncMessage, error) {
	var msg SyncMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func (m *DCSyncManager) WaitForSync(targetVersion int64, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if m.GetVersion() >= targetVersion {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errors.New("sync timeout")
}
