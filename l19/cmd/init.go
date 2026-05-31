package cmd

import (
	"fmt"

	"dbdoctor/internal/config"

	"github.com/spf13/cobra"
)

var initCmd = &cobra.Command{
	Use:   "init",
	Short: "初始化配置文件",
	Long:  "创建默认配置文件到 ~/.dbdoctor/config.yaml",
	RunE: func(cmd *cobra.Command, args []string) error {
		path, err := config.GetConfigPath()
		if err != nil {
			return err
		}

		cfg := config.DefaultConfig()
		if err := cfg.Save(); err != nil {
			return err
		}

		fmt.Printf("✅ 配置文件已创建: %s\n", path)
		fmt.Println("\n配置文件示例:")
		fmt.Println("  default_cluster: local")
		fmt.Println("  clusters:")
		fmt.Println("    - name: local")
		fmt.Println("      sql_host: localhost")
		fmt.Println("      sql_port: 26257")
		fmt.Println("      http_host: localhost")
		fmt.Println("      http_port: 8080")
		fmt.Println("      user: root")
		fmt.Println("      database: defaultdb")
		fmt.Println("      ssl_mode: disable")
		fmt.Println("  s3:")
		fmt.Println("    access_key: your-access-key")
		fmt.Println("    secret_key: your-secret-key")
		fmt.Println("    region: us-east-1")
		fmt.Println("    bucket: your-backup-bucket")
		fmt.Println("  health_check:")
		fmt.Println("    heartbeat_interval_seconds: 5")
		fmt.Println("    failure_threshold: 3")
		fmt.Println("    timeout_seconds: 10")

		return nil
	},
}

func init() {
	rootCmd.AddCommand(initCmd)
}
