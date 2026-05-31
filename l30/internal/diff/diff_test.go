package diff

import (
	"context"
	"testing"
)

func TestCompareStreaming(t *testing.T) {
	local := map[string]string{
		"app/name":    "myapp",
		"app/version": "1.0.0",
		"app/debug":   "true",
	}
	remote := map[string]string{
		"app/name":    "myapp",
		"app/version": "2.0.0",
		"app/port":    "8080",
	}

	localIt := NewMapIterator(local)
	remoteIt := NewMapIterator(remote)
	defer localIt.Close()
	defer remoteIt.Close()

	changes, err := CompareStreaming(context.Background(), localIt, remoteIt)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedChanges := 3
	if len(changes) != expectedChanges {
		t.Errorf("expected %d changes, got %d", expectedChanges, len(changes))
	}

	changeMap := make(map[string]ChangeType)
	for _, c := range changes {
		changeMap[c.Key] = c.Type
	}

	if changeMap["app/debug"] != Removed {
		t.Errorf("expected app/debug to be Removed, got %v", changeMap["app/debug"])
	}
	if changeMap["app/port"] != Added {
		t.Errorf("expected app/port to be Added, got %v", changeMap["app/port"])
	}
	if changeMap["app/version"] != Modified {
		t.Errorf("expected app/version to be Modified, got %v", changeMap["app/version"])
	}
}

func TestCompareStreaming_NoChanges(t *testing.T) {
	data := map[string]string{
		"a": "1",
		"b": "2",
		"c": "3",
	}

	localIt := NewMapIterator(data)
	remoteIt := NewMapIterator(data)
	defer localIt.Close()
	defer remoteIt.Close()

	changes, err := CompareStreaming(context.Background(), localIt, remoteIt)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(changes) != 0 {
		t.Errorf("expected 0 changes, got %d", len(changes))
	}
}

func TestCompareStreaming_EmptyLocal(t *testing.T) {
	local := map[string]string{}
	remote := map[string]string{
		"a": "1",
		"b": "2",
	}

	localIt := NewMapIterator(local)
	remoteIt := NewMapIterator(remote)
	defer localIt.Close()
	defer remoteIt.Close()

	changes, err := CompareStreaming(context.Background(), localIt, remoteIt)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(changes) != 2 {
		t.Errorf("expected 2 changes, got %d", len(changes))
	}
	for _, c := range changes {
		if c.Type != Added {
			t.Errorf("expected key %s to be Added, got %v", c.Key, c.Type)
		}
	}
}

func TestCompareStreaming_EmptyRemote(t *testing.T) {
	local := map[string]string{
		"a": "1",
		"b": "2",
	}
	remote := map[string]string{}

	localIt := NewMapIterator(local)
	remoteIt := NewMapIterator(remote)
	defer localIt.Close()
	defer remoteIt.Close()

	changes, err := CompareStreaming(context.Background(), localIt, remoteIt)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(changes) != 2 {
		t.Errorf("expected 2 changes, got %d", len(changes))
	}
	for _, c := range changes {
		if c.Type != Removed {
			t.Errorf("expected key %s to be Removed, got %v", c.Key, c.Type)
		}
	}
}

func TestCompareStreamingFunc(t *testing.T) {
	local := map[string]string{
		"a": "1",
		"c": "3",
	}
	remote := map[string]string{
		"b": "2",
		"c": "4",
	}

	localIt := NewMapIterator(local)
	remoteIt := NewMapIterator(remote)
	defer localIt.Close()
	defer remoteIt.Close()

	changes := []Change{}
	handler := func(c Change) error {
		changes = append(changes, c)
		return nil
	}

	err := CompareStreamingFunc(context.Background(), localIt, remoteIt, handler)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(changes) != 3 {
		t.Errorf("expected 3 changes, got %d", len(changes))
	}
}

func TestCompareStreaming_SortedKeys(t *testing.T) {
	local := map[string]string{
		"z": "last",
		"a": "first",
		"m": "middle",
	}
	remote := map[string]string{
		"m": "middle",
		"a": "first",
		"z": "changed",
	}

	localIt := NewMapIterator(local)
	remoteIt := NewMapIterator(remote)
	defer localIt.Close()
	defer remoteIt.Close()

	changes, err := CompareStreaming(context.Background(), localIt, remoteIt)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(changes) != 1 {
		t.Errorf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Key != "z" {
		t.Errorf("expected change for 'z', got '%s'", changes[0].Key)
	}
}

func TestMapIterator(t *testing.T) {
	data := map[string]string{
		"b": "2",
		"a": "1",
		"c": "3",
	}

	it := NewMapIterator(data)
	defer it.Close()

	ctx := context.Background()
	keys := []string{}
	for {
		kv, err := it.Next(ctx)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if kv == nil {
			break
		}
		keys = append(keys, kv.Key)
	}

	expected := []string{"a", "b", "c"}
	if len(keys) != len(expected) {
		t.Errorf("expected %d keys, got %d", len(expected), len(keys))
	}
	for i, k := range expected {
		if keys[i] != k {
			t.Errorf("expected key %d to be %q, got %q", i, k, keys[i])
		}
	}
}
