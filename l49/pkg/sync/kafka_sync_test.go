package sync

import (
	"testing"
	"time"
)

func TestMockKafkaProducer(t *testing.T) {
	producer := NewMockKafkaProducer("dc1")

	if producer.GetMessageCount() != 0 {
		t.Error("Initial message count should be 0")
	}

	msg := &SyncMessage{
		Operation: OpKeyAdded,
		EntityType: "key",
		EntityID: "key1",
	}

	err := producer.Send(msg)
	if err != nil {
		t.Fatalf("Failed to send: %v", err)
	}

	if producer.GetMessageCount() != 1 {
		t.Errorf("Expected 1 message, got %d", producer.GetMessageCount())
	}

	messages := producer.GetMessages()
	if messages[0].DCID != "dc1" {
		t.Errorf("Expected DCID dc1, got %s", messages[0].DCID)
	}
	if messages[0].Operation != OpKeyAdded {
		t.Error("Operation mismatch")
	}
}

func TestMockKafkaConsumer(t *testing.T) {
	producer := NewMockKafkaProducer("dc1")

	received := make([]*SyncMessage, 0)
	handler := func(msg *SyncMessage) error {
		received = append(received, msg)
		return nil
	}

	consumer := NewMockKafkaConsumer("dc2", handler)
	producer.RegisterConsumer(consumer)
	consumer.Start()
	defer consumer.Stop()

	msg := &SyncMessage{
		Operation: OpColumnAdded,
		EntityType: "column",
		EntityID: "users.email",
	}
	producer.Send(msg)

	time.Sleep(50 * time.Millisecond)

	if len(received) != 1 {
		t.Errorf("Expected 1 received message, got %d", len(received))
	}

	if consumer.GetLastOffset() != 1 {
		t.Errorf("Expected offset 1, got %d", consumer.GetLastOffset())
	}
}

func TestDCSyncManagerBasic(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)
	manager.Start()
	defer manager.Stop()

	if manager.GetDCID() != "dc1" {
		t.Error("DCID mismatch")
	}
	if !manager.IsPrimary() {
		t.Error("Should be primary")
	}
	if manager.GetVersion() != 0 {
		t.Errorf("Expected version 0, got %d", manager.GetVersion())
	}
}

func TestDCSyncManagerPublish(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)
	manager.Start()
	defer manager.Stop()

	err := manager.PublishKeyAdded("key1", 1, map[string]interface{}{"name": "test"})
	if err != nil {
		t.Fatalf("PublishKeyAdded failed: %v", err)
	}

	err = manager.PublishColumnAdded("users", "email", map[string]interface{}{"encrypted": true})
	if err != nil {
		t.Fatalf("PublishColumnAdded failed: %v", err)
	}

	err = manager.PublishKeyRotated(1, 2, "key1")
	if err != nil {
		t.Fatalf("PublishKeyRotated failed: %v", err)
	}

	if manager.GetVersion() != 3 {
		t.Errorf("Expected version 3, got %d", manager.GetVersion())
	}
}

func TestDCSyncManagerPeerDC(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)

	manager.AddPeerDC("dc2")
	manager.AddPeerDC("dc3")

	peers := manager.GetPeerDCs()
	if len(peers) != 2 {
		t.Errorf("Expected 2 peers, got %d", len(peers))
	}

	manager.RemovePeerDC("dc2")
	peers = manager.GetPeerDCs()
	if len(peers) != 1 {
		t.Errorf("Expected 1 peer after remove, got %d", len(peers))
	}
}

func TestDCSyncManagerCallbacks(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)
	manager.Start()
	defer manager.Stop()

	callbackCalled := make(chan bool, 1)
	manager.OnOperation(OpKeyAdded, func(msg *SyncMessage) error {
		callbackCalled <- true
		return nil
	})

	manager2 := NewDCSyncManager("dc2", false)
	manager2.Start()
	defer manager2.Stop()

	callbackCalled2 := make(chan bool, 1)
	manager2.OnOperation(OpKeyAdded, func(msg *SyncMessage) error {
		callbackCalled2 <- true
		return nil
	})

	manager.GetProducer().RegisterConsumer(manager2.consumer)

	err := manager.PublishKeyAdded("key1", 1, nil)
	if err != nil {
		t.Fatalf("Publish failed: %v", err)
	}

	select {
	case <-callbackCalled:
	case <-time.After(100 * time.Millisecond):
		t.Error("Local callback not called")
	}

	select {
	case <-callbackCalled2:
	case <-time.After(100 * time.Millisecond):
		t.Error("Remote callback not called")
	}
}

func TestDCSyncManagerState(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)
	manager.Start()
	defer manager.Stop()

	metadata := map[string]interface{}{"algo": "rc4", "version": "1"}
	manager.PublishKeyAdded("key1", 1, metadata)

	time.Sleep(50 * time.Millisecond)

	state, exists := manager.GetState("key1")
	if !exists {
		t.Error("State should exist")
	}

	stateMap, ok := state.(map[string]interface{})
	if !ok {
		t.Fatal("State should be a map")
	}

	if stateMap["algo"] != "rc4" {
		t.Error("State content mismatch")
	}
}

func TestMessageSerialization(t *testing.T) {
	msg := &SyncMessage{
		ID:        "test-1",
		Operation: OpKeyAdded,
		DCID:      "dc1",
		EntityID:  "key1",
		Version:   5,
		Payload: map[string]interface{}{
			"foo": "bar",
			"num": float64(42),
		},
	}

	data, err := SerializeMessage(msg)
	if err != nil {
		t.Fatalf("Serialize failed: %v", err)
	}

	deserialized, err := DeserializeMessage(data)
	if err != nil {
		t.Fatalf("Deserialize failed: %v", err)
	}

	if deserialized.Operation != OpKeyAdded {
		t.Error("Operation mismatch after serialization")
	}
	if deserialized.EntityID != "key1" {
		t.Error("EntityID mismatch after serialization")
	}
	if deserialized.Version != 5 {
		t.Error("Version mismatch after serialization")
	}
}

func TestDCSyncManagerColumnOperations(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)
	manager.Start()
	defer manager.Stop()

	manager.PublishColumnAdded("users", "phone", map[string]interface{}{"type": "string"})
	manager.PublishColumnUpdated("users", "phone", map[string]interface{}{"type": "varchar"})
	manager.PublishColumnRemoved("users", "phone")

	if manager.GetVersion() != 3 {
		t.Errorf("Expected version 3, got %d", manager.GetVersion())
	}
}

func TestDCSyncManagerWaitForSync(t *testing.T) {
	manager := NewDCSyncManager("dc1", true)
	manager.Start()
	defer manager.Stop()

	for i := 0; i < 5; i++ {
		manager.PublishKeyAdded(string(rune('a'+i)), i+1, nil)
	}

	err := manager.WaitForSync(5, time.Second)
	if err != nil {
		t.Errorf("WaitForSync failed: %v", err)
	}

	err = manager.WaitForSync(100, 50*time.Millisecond)
	if err == nil {
		t.Error("Should timeout waiting for unreachable version")
	}
}

func TestSyncMessageTypes(t *testing.T) {
	ops := []SyncOperation{
		OpKeyAdded,
		OpKeyRemoved,
		OpKeyRotated,
		OpColumnAdded,
		OpColumnRemoved,
		OpColumnUpdated,
		OpConfigChanged,
	}

	if len(ops) != 7 {
		t.Errorf("Expected 7 operation types, got %d", len(ops))
	}
}
