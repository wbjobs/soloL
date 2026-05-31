package diff

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/fatih/color"
)

type ChangeType int

const (
	Added ChangeType = iota
	Removed
	Modified
)

type Change struct {
	Key      string
	Type     ChangeType
	OldValue string
	NewValue string
}

func Compare(local, remote map[string]string) []Change {
	localIt := NewMapIterator(local)
	remoteIt := NewMapIterator(remote)
	defer localIt.Close()
	defer remoteIt.Close()

	changes, err := CompareStreaming(context.Background(), localIt, remoteIt)
	if err != nil {
		return nil
	}
	return changes
}

func CompareStreaming(ctx context.Context, localIt, remoteIt KVIterator) ([]Change, error) {
	changes := []Change{}

	localKV, err := localIt.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("local iterator: %w", err)
	}
	remoteKV, err := remoteIt.Next(ctx)
	if err != nil {
		return nil, fmt.Errorf("remote iterator: %w", err)
	}

	for localKV != nil || remoteKV != nil {
		switch {
		case localKV == nil:
			changes = append(changes, Change{
				Key:      remoteKV.Key,
				Type:     Added,
				NewValue: remoteKV.Value,
			})
			remoteKV, err = remoteIt.Next(ctx)
		case remoteKV == nil:
			changes = append(changes, Change{
				Key:      localKV.Key,
				Type:     Removed,
				OldValue: localKV.Value,
			})
			localKV, err = localIt.Next(ctx)
		case localKV.Key < remoteKV.Key:
			changes = append(changes, Change{
				Key:      localKV.Key,
				Type:     Removed,
				OldValue: localKV.Value,
			})
			localKV, err = localIt.Next(ctx)
		case localKV.Key > remoteKV.Key:
			changes = append(changes, Change{
				Key:      remoteKV.Key,
				Type:     Added,
				NewValue: remoteKV.Value,
			})
			remoteKV, err = remoteIt.Next(ctx)
		default:
			if localKV.Value != remoteKV.Value {
				changes = append(changes, Change{
					Key:      localKV.Key,
					Type:     Modified,
					OldValue: localKV.Value,
					NewValue: remoteKV.Value,
				})
			}
			localKV, err = localIt.Next(ctx)
			if err != nil {
				return nil, fmt.Errorf("local iterator: %w", err)
			}
			remoteKV, err = remoteIt.Next(ctx)
		}
		if err != nil {
			return nil, fmt.Errorf("remote iterator: %w", err)
		}
	}

	return changes, nil
}

type ChangeHandler func(Change) error

func CompareStreamingFunc(ctx context.Context, localIt, remoteIt KVIterator, handler ChangeHandler) error {
	localKV, err := localIt.Next(ctx)
	if err != nil {
		return fmt.Errorf("local iterator: %w", err)
	}
	remoteKV, err := remoteIt.Next(ctx)
	if err != nil {
		return fmt.Errorf("remote iterator: %w", err)
	}

	for localKV != nil || remoteKV != nil {
		var change *Change

		switch {
		case localKV == nil:
			change = &Change{
				Key:      remoteKV.Key,
				Type:     Added,
				NewValue: remoteKV.Value,
			}
			remoteKV, err = remoteIt.Next(ctx)
		case remoteKV == nil:
			change = &Change{
				Key:      localKV.Key,
				Type:     Removed,
				OldValue: localKV.Value,
			}
			localKV, err = localIt.Next(ctx)
		case localKV.Key < remoteKV.Key:
			change = &Change{
				Key:      localKV.Key,
				Type:     Removed,
				OldValue: localKV.Value,
			}
			localKV, err = localIt.Next(ctx)
		case localKV.Key > remoteKV.Key:
			change = &Change{
				Key:      remoteKV.Key,
				Type:     Added,
				NewValue: remoteKV.Value,
			}
			remoteKV, err = remoteIt.Next(ctx)
		default:
			if localKV.Value != remoteKV.Value {
				change = &Change{
					Key:      localKV.Key,
					Type:     Modified,
					OldValue: localKV.Value,
					NewValue: remoteKV.Value,
				}
			}
			localKV, err = localIt.Next(ctx)
			if err != nil {
				return fmt.Errorf("local iterator: %w", err)
			}
			remoteKV, err = remoteIt.Next(ctx)
		}
		if err != nil {
			return fmt.Errorf("iterator error: %w", err)
		}

		if change != nil {
			if err := handler(*change); err != nil {
				return err
			}
		}
	}

	return nil
}

func PrintChanges(w io.Writer, changes []Change) {
	if len(changes) == 0 {
		fmt.Fprintln(w, color.GreenString("No differences found."))
		return
	}

	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()

	for _, c := range changes {
		printChange(w, c, green, red, yellow)
	}
}

func PrintChange(w io.Writer, c Change) {
	green := color.New(color.FgGreen).SprintFunc()
	red := color.New(color.FgRed).SprintFunc()
	yellow := color.New(color.FgYellow).SprintFunc()
	printChange(w, c, green, red, yellow)
}

func printChange(w io.Writer, c Change, green, red, yellow func(a ...interface{}) string) {
	switch c.Type {
	case Added:
		fmt.Fprintf(w, "%s %s\n", green("+ "+c.Key), formatValue(c.NewValue))
	case Removed:
		fmt.Fprintf(w, "%s %s\n", red("- "+c.Key), formatValue(c.OldValue))
	case Modified:
		fmt.Fprintf(w, "%s %s\n", yellow("~ "+c.Key), "")
		fmt.Fprintf(w, "  %s %s\n", red("-"), formatValue(c.OldValue))
		fmt.Fprintf(w, "  %s %s\n", green("+"), formatValue(c.NewValue))
	}
}

func formatValue(v string) string {
	if strings.Contains(v, "\n") {
		lines := strings.Split(v, "\n")
		var sb strings.Builder
		for i, line := range lines {
			if i == 0 {
				sb.WriteString(line + "\n")
			} else {
				sb.WriteString("    " + line + "\n")
			}
		}
		return sb.String()
	}
	return v
}
