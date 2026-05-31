package yamlutil

import (
	"strings"
	"testing"
)

func TestValidateYAMLIndentation_BadIndent(t *testing.T) {
	input := `app:
  name: myapp
   version: "1.0.0"
  debug: false
`
	err := validateYAMLIndentation(strings.NewReader(input))
	if err == nil {
		t.Fatal("expected error for bad indentation, got nil")
	}
	if !strings.Contains(err.Error(), "unexpected indentation jump") {
		t.Errorf("expected 'unexpected indentation jump' error, got: %v", err)
	}
}

func TestValidateYAMLIndentation_MixedTabsSpaces(t *testing.T) {
	input := "app:\n  name: myapp\n\tversion: \"1.0.0\"\n"
	err := validateYAMLIndentation(strings.NewReader(input))
	if err == nil {
		t.Fatal("expected error for mixed tabs/spaces, got nil")
	}
	if !strings.Contains(err.Error(), "inconsistent indentation character") {
		t.Errorf("expected 'inconsistent indentation character' error, got: %v", err)
	}
}

func TestValidateYAMLIndentation_MixedTabsSpacesSameLine(t *testing.T) {
	input := "app:\n  \tname: myapp\n"
	err := validateYAMLIndentation(strings.NewReader(input))
	if err == nil {
		t.Fatal("expected error for mixed tabs/spaces on same line, got nil")
	}
	if !strings.Contains(err.Error(), "mixed tabs and spaces in indentation") {
		t.Errorf("expected 'mixed tabs and spaces in indentation' error, got: %v", err)
	}
}

func TestValidateYAMLIndentation_Valid(t *testing.T) {
	input := `app:
  name: myapp
  version: "1.0.0"
  debug: false
  database:
    host: localhost
    port: 5432
`
	err := validateYAMLIndentation(strings.NewReader(input))
	if err != nil {
		t.Errorf("expected no error for valid YAML, got: %v", err)
	}
}

func TestValidateYAMLIndentation_ValidList(t *testing.T) {
	input := `features:
  - name: auth
    enabled: true
  - name: cache
    enabled: false
`
	err := validateYAMLIndentation(strings.NewReader(input))
	if err != nil {
		t.Errorf("expected no error for valid list YAML, got: %v", err)
	}
}

func TestFlattenFile_Simple(t *testing.T) {
	input := `app:
  name: myapp
  version: "1.0.0"
  debug: false
`
	result, err := FlattenReader(strings.NewReader(input), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := map[string]string{
		"app/name":    "myapp",
		"app/version": "1.0.0",
		"app/debug":   "false",
	}

	for k, v := range expected {
		if result[k] != v {
			t.Errorf("key %s: expected %q, got %q", k, v, result[k])
		}
	}
}

func TestFlattenFile_List(t *testing.T) {
	input := `features:
  - name: auth
    enabled: true
  - name: cache
    enabled: false
`
	result, err := FlattenReader(strings.NewReader(input), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := map[string]string{
		"features[0]/name":    "auth",
		"features[0]/enabled": "true",
		"features[1]/name":    "cache",
		"features[1]/enabled": "false",
	}

	for k, v := range expected {
		if result[k] != v {
			t.Errorf("key %s: expected %q, got %q", k, v, result[k])
		}
	}
}
