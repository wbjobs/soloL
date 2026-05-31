package yamlutil

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"etcd-config-cli/internal/diff"

	"gopkg.in/yaml.v3"
)

func FlattenFile(path string, prefix string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	return FlattenReader(f, prefix)
}

func FlattenReader(r io.Reader, prefix string) (map[string]string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("read: %w", err)
	}

	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", formatYAMLError(err, data))
	}

	result := make(map[string]string)
	if err := flattenNode(&root, prefix, result); err != nil {
		return nil, err
	}
	return result, nil
}

func formatYAMLError(err error, data []byte) error {
	type lineError interface {
		Line() int
		Error() string
	}

	if le, ok := err.(lineError); ok {
		lineNum := le.Line()
		lines := strings.Split(string(data), "\n")
		if lineNum > 0 && lineNum <= len(lines) {
			var buf bytes.Buffer
			start := max(0, lineNum-3)
			end := min(len(lines), lineNum+2)

			buf.WriteString(fmt.Sprintf("YAML parse error at line %d:\n", lineNum))
			for i := start; i < end; i++ {
				marker := "  "
				if i == lineNum-1 {
					marker = ">>"
				}
				buf.WriteString(fmt.Sprintf("%s %4d: %s\n", marker, i+1, lines[i]))
			}
			if lineNum-1 >= 0 && lineNum-1 < len(lines) {
				indent := len(lines[lineNum-1]) - len(strings.TrimLeft(lines[lineNum-1], " \t"))
				buf.WriteString(fmt.Sprintf("        %s^ indentation level: %d spaces\n",
					strings.Repeat(" ", indent), indent))
			}
			buf.WriteString(le.Error())
			return fmt.Errorf("%s", buf.String())
		}
	}
	return err
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func flattenNode(node *yaml.Node, prefix string, result map[string]string) error {
	switch node.Kind {
	case yaml.DocumentNode:
		for _, child := range node.Content {
			if err := flattenNode(child, prefix, result); err != nil {
				return err
			}
		}

	case yaml.MappingNode:
		for i := 0; i < len(node.Content); i += 2 {
			key := node.Content[i]
			val := node.Content[i+1]

			if key.Kind != yaml.ScalarNode {
				return fmt.Errorf("non-scalar key at line %d", key.Line)
			}

			keyStr := key.Value
			newPrefix := keyStr
			if prefix != "" {
				newPrefix = prefix + "/" + keyStr
			}

			if err := flattenNode(val, newPrefix, result); err != nil {
				return err
			}
		}

	case yaml.SequenceNode:
		for i, child := range node.Content {
			newPrefix := fmt.Sprintf("%s[%d]", prefix, i)
			if err := flattenNode(child, newPrefix, result); err != nil {
				return err
			}
		}

	case yaml.ScalarNode:
		result[prefix] = node.Value

	case yaml.AliasNode:
		if err := flattenNode(node.Alias, prefix, result); err != nil {
			return err
		}
	}

	return nil
}

type YAMLIterator struct {
	keys   []string
	values map[string]string
	idx    int
}

func NewYAMLIterator(path string, prefix string) (*YAMLIterator, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	if err := validateYAMLIndentation(f); err != nil {
		return nil, err
	}

	f.Seek(0, 0)
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}

	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", formatYAMLError(err, data))
	}

	result := make(map[string]string)
	if err := flattenNode(&root, prefix, result); err != nil {
		return nil, err
	}

	keys := make([]string, 0, len(result))
	for k := range result {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	return &YAMLIterator{
		keys:   keys,
		values: result,
		idx:    0,
	}, nil
}

type indentState struct {
	level       int
	indents     []int
	line        int
	inBlock     bool
	blockIndent int
	indentChar  byte
}

func validateYAMLIndentation(r io.Reader) error {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)

	state := &indentState{
		indents:    []int{-1},
		indentChar: 0,
	}

	for scanner.Scan() {
		state.line++
		line := scanner.Text()

		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		leading := line[:len(line)-len(trimmed)]
		if strings.Contains(leading, "\t") && strings.Contains(leading, " ") {
			return fmt.Errorf(
				"mixed tabs and spaces in indentation at line %d\n"+
					"  Line: %q\n"+
					"  Use either tabs or spaces consistently for indentation",
				state.line, line)
		}

		if len(leading) > 0 {
			char := leading[0]
			if state.indentChar == 0 {
				state.indentChar = char
			} else if char != state.indentChar {
				expected := "spaces"
				got := "tabs"
				if state.indentChar == '\t' {
					expected = "tabs"
					got = "spaces"
				}
				return fmt.Errorf(
					"inconsistent indentation character at line %d\n"+
						"  Line: %q\n"+
						"  Expected %s but got %s\n"+
						"  Use either tabs or spaces consistently throughout the file",
					state.line, line, expected, got)
			}
		}

		indent := len(line) - len(trimmed)

		if strings.HasPrefix(trimmed, "|") || strings.HasPrefix(trimmed, ">") {
			state.inBlock = true
			state.blockIndent = indent
			continue
		}

		if state.inBlock {
			if indent > state.blockIndent {
				continue
			}
			state.inBlock = false
		}

		if strings.HasPrefix(trimmed, "- ") || trimmed == "-" {
			for len(state.indents) > 1 && state.indents[len(state.indents)-1] >= indent {
				state.indents = state.indents[:len(state.indents)-1]
			}

			prev := state.indents[len(state.indents)-1]
			if prev >= 0 {
				if indent != prev && indent != prev+2 && indent != prev+4 {
					return fmt.Errorf(
						"inconsistent indentation for list item at line %d\n"+
							"  Line: %q\n"+
							"  Expected indentation of %d, %d, or %d spaces, got: %d spaces\n"+
							"  Hint: List items should be at the same level as parent or indented by 2/4 spaces",
						state.line, line, prev, prev+2, prev+4, indent)
				}
			} else {
				if indent != 0 && indent != 2 && indent != 4 {
					return fmt.Errorf(
						"inconsistent indentation for list item at line %d\n"+
							"  Line: %q\n"+
							"  Expected indentation of 0, 2, or 4 spaces for root level, got: %d spaces",
						state.line, line, indent)
				}
			}
			continue
		}

		if strings.Contains(trimmed, ": ") || strings.HasSuffix(trimmed, ":") {
			for len(state.indents) > 1 && state.indents[len(state.indents)-1] >= indent {
				state.indents = state.indents[:len(state.indents)-1]
			}

			if indent == state.indents[len(state.indents)-1] {
				continue
			}

			if indent > state.indents[len(state.indents)-1] {
				prev := state.indents[len(state.indents)-1]
				if prev >= 0 && indent != prev+2 && indent != prev+4 {
					return fmt.Errorf(
						"unexpected indentation jump at line %d\n"+
							"  Line: %q\n"+
							"  Previous level: %d spaces, current: %d spaces\n"+
							"  Hint: YAML typically uses 2 or 4 spaces per indentation level",
						state.line, line, prev, indent)
				}
				state.indents = append(state.indents, indent)
			} else {
				return fmt.Errorf(
					"inconsistent indentation at line %d\n"+
						"  Line: %q\n"+
						"  Expected indentation <= %d spaces, got: %d spaces",
					state.line, line, state.indents[len(state.indents)-1], indent)
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read file: %w", err)
	}

	return nil
}

func (it *YAMLIterator) Next(ctx context.Context) (*diff.KVPair, error) {
	if it.idx >= len(it.keys) {
		return nil, nil
	}
	key := it.keys[it.idx]
	it.idx++
	return &diff.KVPair{
		Key:   key,
		Value: it.values[key],
	}, nil
}

func (it *YAMLIterator) Close() error {
	it.keys = nil
	it.values = nil
	return nil
}

func FormatKeyForDisplay(key string) string {
	return strings.TrimPrefix(key, "/")
}
