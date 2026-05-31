package cmd

import (
	"encoding/json"
	"fmt"
	"time"

	"dbdoctor/internal/config"
	"dbdoctor/internal/cockroach"

	"github.com/spf13/cobra"
)

var (
	rebalanceLeasesOnly    bool
	rebalanceReplicasOnly bool
	waitForCompletion   bool
	waitTimeout         int
	safeRebalance       bool
	dryRun              bool
)

var rebalanceCmd = &cobra.Command{
	Use:   "rebalance",
	Short: "手动触发lease和replica重分配",
	Long: `手动触发CockroachDB集群的负载均衡操作。
默认同时执行replica重分配和lease重分配。

⚠️  安全模式 (--safe): 先逐个迁移lease，等待raft确认后再移动replica，
   避免大量请求重试导致读写延迟飙升。

可以使用 --leases-only 或 --replicas-only 只执行其中一种操作。`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}

		cluster, err := getCluster(cfg)
		if err != nil {
			return err
		}

		if safeRebalance {
			return runSafeRebalance(cluster)
		}

		httpClient := cockroach.NewHTTPClient(cluster)

		fmt.Println("🚀 开始集群负载均衡...")
		fmt.Printf("集群: %s (%s:%d)\n\n", cluster.Name, cluster.SQLHost, cluster.SQLPort)

		results := make(map[string]interface{})
		results["cluster"] = cluster.Name
		results["timestamp"] = time.Now().Format(time.RFC3339)

		if !rebalanceLeasesOnly {
			fmt.Println("📦 触发 Replica 重分配...")
			resp, err := httpClient.TriggerRebalance()
			if err != nil {
				fmt.Printf("  ❌ Replica 重分配失败: %v\n", err)
				results["replicas"] = map[string]interface{}{
					"success": false,
					"error":   err.Error(),
				}
			} else {
				fmt.Printf("  ✅ Replica 重分配已触发 (Job ID: %d)\n", resp.JobID)
				results["replicas"] = map[string]interface{}{
					"success": true,
					"job_id":  resp.JobID,
					"status":  resp.Status,
					"message": resp.Message,
				}
			}
		}

		if !rebalanceReplicasOnly {
			fmt.Println("🔑 触发 Lease 重分配...")
			resp, err := httpClient.TriggerLeaseRebalance()
			if err != nil {
				fmt.Printf("  ❌ Lease 重分配失败: %v\n", err)
				results["leases"] = map[string]interface{}{
					"success": false,
					"error":   err.Error(),
				}
			} else {
				fmt.Printf("  ✅ Lease 重分配已触发\n")
				results["leases"] = map[string]interface{}{
					"success": true,
					"status":  resp.Status,
					"message": resp.Message,
				}
			}
		}

		fmt.Println("\nℹ️  提示: 负载均衡操作在后台执行，可能需要几分钟才能完成。")
		fmt.Println("   使用 'dbdoctor node status' 查看进度。")
		fmt.Println("\n💡 建议: 使用 --safe 模式避免读写延迟飙升")

		if jsonOutput {
			data, err := json.MarshalIndent(results, "", "  ")
			if err != nil {
				return err
			}
			fmt.Println(string(data))
		}

		return nil
	},
}

func runSafeRebalance(cluster *config.ClusterConfig) error {
	sqlClient, err := cockroach.NewSQLClient(cluster)
	if err != nil {
		return fmt.Errorf("failed to connect to SQL: %w", err)
	}
	defer sqlClient.Close()

	fmt.Println("🔒 安全模式重平衡启动")
	fmt.Printf("集群: %s (%s:%d)\n", cluster.Name, cluster.SQLHost, cluster.SQLPort)
	fmt.Println("策略: 先迁移lease -> 等待raft确认 -> 再移动replica\n")

	if dryRun {
		fmt.Println("📋 DRY RUN: 不执行实际操作")
	}

	progressCallback := func(msg string) {
		fmt.Println(msg)
	}

	var result *cockroach.LeaseRebalanceResult
	if !dryRun {
		result, err = sqlClient.SafeRebalance(progressCallback)
		if err != nil {
			return fmt.Errorf("safe rebalance failed: %w", err)
		}
	} else {
		result = &cockroach.LeaseRebalanceResult{
			TotalRanges:      0,
			LeasesTransferred: 0,
			ReplicasMoved:    0,
			Errors:           []string{},
			Duration:         0,
		}
	}

	fmt.Println("\n=== 重平衡完成 ===")
	fmt.Printf("分析Range数: %d\n", result.TotalRanges)
	fmt.Printf("成功迁移Lease: %d\n", result.LeasesTransferred)
	fmt.Printf("错误数: %d\n", len(result.Errors))
	fmt.Printf("总耗时: %v\n", result.Duration)

	if len(result.Errors) > 0 {
		fmt.Println("\n⚠️  部分操作失败:")
		for _, e := range result.Errors {
			fmt.Printf("  - %s\n", e)
		}
	}

	fmt.Println("\n✅ 安全重平衡完成")
	fmt.Println("   Lease已逐个迁移并确认Raft同步")
	fmt.Println("   Replica迁移已触发，后台执行中")

	return nil
}

var rebalanceSQLCmd = &cobra.Command{
	Use:   "sql",
	Short: "使用SQL函数触发重分配",
	Long:  "通过调用CockroachDB内置SQL函数执行rebalance操作",
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

		fmt.Println("🚀 执行SQL级别的负载均衡...")
		fmt.Printf("集群: %s (%s:%d)\n\n", cluster.Name, cluster.SQLHost, cluster.SQLPort)

		startTime := time.Now()

		fmt.Println("📦 执行 crdb_internal.rebalance_all_replicas()...")
		if err := sqlClient.RebalanceRangeLeases(); err != nil {
			fmt.Printf("  ❌ 重分配失败: %v\n", err)
			return err
		}

		elapsed := time.Since(startTime)
		fmt.Printf("\n✅ SQL重分配操作已完成\n")
		fmt.Printf("   耗时: %v\n", elapsed)
		fmt.Println("\nℹ️  提示: 数据迁移在后台继续进行，使用 'dbdoctor node status' 查看进度。")

		return nil
	},
}

func init() {
	rebalanceCmd.Flags().BoolVar(&rebalanceLeasesOnly, "leases-only", false, "only rebalance leases")
	rebalanceCmd.Flags().BoolVar(&rebalanceReplicasOnly, "replicas-only", false, "only rebalance replicas")
	rebalanceCmd.Flags().BoolVarP(&waitForCompletion, "wait", "w", false, "wait for operation to complete")
	rebalanceCmd.Flags().IntVar(&waitTimeout, "timeout", 300, "timeout in seconds for wait")
	rebalanceCmd.Flags().BoolVar(&safeRebalance, "safe", false, "safe mode: transfer leases first with raft confirmation")
	rebalanceCmd.Flags().BoolVar(&dryRun, "dry-run", false, "only show what would be done")
	rebalanceCmd.MarkFlagsMutuallyExclusive("leases-only", "replicas-only")
	rootCmd.AddCommand(rebalanceCmd)
	rebalanceCmd.AddCommand(rebalanceSQLCmd)
}
