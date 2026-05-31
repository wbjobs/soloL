package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dbdoctor/internal/cockroach"
	"dbdoctor/internal/health"

	"github.com/spf13/cobra"
)

var (
	healthContinuous bool
	healthInterval   int
	healthWatch      bool
)

var healthCmd = &cobra.Command{
	Use:   "health",
	Short: "集群健康检查",
	Long: `执行集群健康检查，包括心跳检测和网络分区检测。
对每个节点发送心跳，连续3次失败标记为unavailable。`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}

		cluster, err := getCluster(cfg)
		if err != nil {
			return err
		}

		sqlClient, err := cockroach.NewSQLClient(cluster)
		if err != nil {
			return fmt.Errorf("failed to connect to SQL: %w", err)
		}
		defer sqlClient.Close()

		httpClient := cockroach.NewHTTPClient(cluster)
		checker := health.NewHealthChecker(&cfg.HealthCheck, httpClient, sqlClient)

		if healthContinuous || healthWatch {
			return runContinuousChecks(checker)
		}

		report, err := checker.CheckAllNodes()
		if err != nil {
			return fmt.Errorf("health check failed: %w", err)
		}

		if jsonOutput {
			data, _ := json.MarshalIndent(report, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		report.PrintSummary()

		if report.NetworkPartition {
			fmt.Printf("\n⚠️  警告: 检测到网络分区!\n")
			fmt.Printf("   分区节点: %v\n", report.PartitionedNodes)
			os.Exit(2)
		}

		if report.UnavailableNodes > 0 {
			fmt.Printf("\n⚠️  警告: %d 个节点不可用\n", report.UnavailableNodes)
			os.Exit(1)
		}

		fmt.Printf("\n✅ 集群健康，所有节点正常\n")
		return nil
	},
}

func runContinuousChecks(checker *health.HealthChecker) error {
	fmt.Println("🔍 启动持续健康检查...")
	fmt.Println("   按 Ctrl+C 停止")
	fmt.Println()

	interval := healthInterval
	if interval == 0 {
		interval = 5
	}

	resultChan := make(chan *health.HealthReport, 10)
	stopChan := make(chan struct{})
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	go checker.RunContinuousChecks(stopChan, resultChan)

	clearScreen := func() {
		fmt.Print("\033[H\033[2J")
	}

	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case report := <-resultChan:
			if healthWatch {
				clearScreen()
				fmt.Printf("=== 集群健康监控 (刷新间隔: %ds) ===\n", interval)
			}
			fmt.Printf("时间: %s\n", report.Timestamp.Format(time.RFC3339))
			fmt.Printf("总节点: %d | 健康: %d | 不可用: %d\n",
				report.TotalNodes, report.HealthyNodes, report.UnavailableNodes)

			if report.NetworkPartition {
				fmt.Printf("⚠️  网络分区检测! 分区节点: %v\n", report.PartitionedNodes)
			}

			for _, node := range report.Nodes {
				status := "✅"
				if node.Status == "degraded" {
					status = "⚠️"
				} else if node.Status == "unavailable" {
					status = "❌"
				}

				partition := ""
				if node.IsNetworkPartition {
					partition = " [分区]"
				}

				fmt.Printf("%s Node %d: %s (连续失败: %d)%s\n",
					status, node.NodeID, node.Status, node.ConsecutiveFails, partition)

				if node.LastError != "" && !node.Alive {
					fmt.Printf("    错误: %s\n", node.LastError)
				}
			}
			fmt.Println("---")

			if !healthWatch {
				return nil
			}

		case <-sigChan:
			fmt.Println("\n🛑 停止健康检查...")
			close(stopChan)
			return nil

		case <-ticker.C:
		}
	}
}

func init() {
	healthCmd.Flags().BoolVarP(&healthContinuous, "continuous", "C", false, "run continuous health checks (single pass)")
	healthCmd.Flags().BoolVarP(&healthWatch, "watch", "w", false, "watch mode, continuously update display")
	healthCmd.Flags().IntVarP(&healthInterval, "interval", "i", 0, "check interval in seconds (default 5)")
	healthCmd.MarkFlagsMutuallyExclusive("continuous", "watch")
	rootCmd.AddCommand(healthCmd)
}
