package cmd

import (
	"github.com/spf13/cobra"
)

var nodeCmd = &cobra.Command{
	Use:   "node",
	Short: "节点管理命令",
	Long:  "管理CockroachDB集群节点，包括状态查看、健康检查等",
}

func init() {
	rootCmd.AddCommand(nodeCmd)
}
