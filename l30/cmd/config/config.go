package config

import (
	etcdclient "etcd-config-cli/internal/etcd"

	"github.com/spf13/cobra"
)

type ClientLoader func() (*etcdclient.Client, error)

func NewConfigCmd(loadClient ClientLoader) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Manage etcd configurations",
	}

	cmd.AddCommand(newGetCmd(loadClient))
	cmd.AddCommand(newSetCmd(loadClient))
	cmd.AddCommand(newWatchCmd(loadClient))
	cmd.AddCommand(newDiffCmd(loadClient))
	cmd.AddCommand(newHistoryCmd(loadClient))
	cmd.AddCommand(newRollbackCmd(loadClient))

	return cmd
}
