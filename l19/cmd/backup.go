package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"
	"time"

	"dbdoctor/internal/config"
	"dbdoctor/internal/cockroach"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/s3"
	"github.com/spf13/cobra"
)

var (
	backupFull          bool
	backupIncremental   bool
	backupIncrementalFrom string
	backupEncryption    string
	backupTargetTime    string
	backupDatabase      string
	backupList          bool
	backupRestore       bool
	backupJobID         int64
	backupPrefix        string
	backupWithRetry     bool
	backupMaxRetries    int
	backupWait          bool
	backupResumeJobID   int64
)

var backupCmd = &cobra.Command{
	Use:   "backup",
	Short: "集群备份与恢复管理",
	Long: `管理CockroachDB集群的备份和恢复操作。
支持全量备份、增量备份到S3，并支持时间点恢复(PITR)。

⚠️  重试模式 (--with-retry): 针对S3网络抖动场景，自动重试失败的备份任务，
   支持断点续传，检测到已有成功备份时直接返回，检测到运行中任务时等待完成。`,
	RunE: func(cmd *cobra.Command, args []string) error {
		cfg, err := loadConfig()
		if err != nil {
			return err
		}

		cluster, err := getCluster(cfg)
		if err != nil {
			return err
		}

		if cfg.S3 == nil {
			return fmt.Errorf("S3 configuration not found in config file. Please configure S3 settings first.")
		}

		sqlClient, err := cockroach.NewSQLClient(cluster)
		if err != nil {
			return fmt.Errorf("failed to connect to SQL: %w", err)
		}
		defer sqlClient.Close()

		s3Path := buildS3Path(cfg.S3)

		if backupList {
			return listBackups(sqlClient, s3Path)
		}

		if backupJobID > 0 {
			return checkBackupJob(sqlClient, backupJobID)
		}

		if backupRestore {
			return restoreBackup(sqlClient, s3Path, cfg)
		}

		if backupWithRetry || backupWait {
			return createBackupWithRetry(sqlClient, s3Path, cfg)
		}

		return createBackup(sqlClient, s3Path, cfg)
	},
}

func buildS3Path(s3Cfg *config.S3Config) string {
	path := fmt.Sprintf("s3://%s", s3Cfg.Bucket)
	if backupPrefix != "" {
		path += "/" + backupPrefix
	}
	if s3Cfg.PathStyle {
		path += "?AWS_ENDPOINT=" + s3Cfg.Endpoint
	}
	if s3Cfg.AccessKey != "" && s3Cfg.SecretKey != "" {
		path += fmt.Sprintf("&AWS_ACCESS_KEY_ID=%s&AWS_SECRET_ACCESS_KEY=%s",
			s3Cfg.AccessKey, s3Cfg.SecretKey)
	}
	if s3Cfg.Region != "" {
		path += "&AWS_REGION=" + s3Cfg.Region
	}
	return path
}

func createBackup(sqlClient *cockroach.SQLClient, s3Path string, cfg *config.AppConfig) error {
	var backupInfo *cockroach.BackupInfo
	var err error

	backupType := "incremental"
	if backupFull {
		backupType = "full"
	}

	fmt.Printf("💾 创建%s备份...\n", backupType)
	fmt.Printf("目标: s3://%s/%s\n", cfg.S3.Bucket, backupPrefix)
	fmt.Printf("集群: %s\n\n", cfg.DefaultCluster)

	encryptionPass := backupEncryption
	if encryptionPass == "" {
		encryptionPass = os.Getenv("DBDOCTOR_BACKUP_PASSPHRASE")
		if encryptionPass == "" {
			return fmt.Errorf("backup encryption passphrase required. Use --encryption or set DBDOCTOR_BACKUP_PASSPHRASE")
		}
	}

	if backupFull {
		backupInfo, err = sqlClient.CreateFullBackup(s3Path, encryptionPass)
	} else {
		backupInfo, err = sqlClient.CreateIncrementalBackup(s3Path, backupIncrementalFrom, encryptionPass)
	}

	if err != nil {
		return fmt.Errorf("failed to create backup: %w", err)
	}

	fmt.Printf("✅ 备份任务已创建\n")
	fmt.Printf("   Job ID: %d\n", backupInfo.JobID)
	fmt.Printf("   类型: %s\n", backupInfo.BackupType)
	fmt.Printf("   开始时间: %s\n", backupInfo.StartTime.Format(time.RFC3339))
	fmt.Printf("   路径: %s\n", backupInfo.BackupPath)
	if backupInfo.IncrementalFrom != "" {
		fmt.Printf("   增量基准: %s\n", backupInfo.IncrementalFrom)
	}
	fmt.Println("\nℹ️  使用 --job-id <id> 查看任务进度")
	fmt.Println("💡 建议: 使用 --with-retry --wait 确保备份在网络抖动时自动重试并等待完成")

	if jsonOutput {
		data, _ := json.MarshalIndent(backupInfo, "", "  ")
		fmt.Println(string(data))
	}

	return nil
}

func createBackupWithRetry(sqlClient *cockroach.SQLClient, s3Path string, cfg *config.AppConfig) error {
	backupType := "incremental"
	if backupFull {
		backupType = "full"
	}

	encryptionPass := backupEncryption
	if encryptionPass == "" {
		encryptionPass = os.Getenv("DBDOCTOR_BACKUP_PASSPHRASE")
		if encryptionPass == "" {
			return fmt.Errorf("backup encryption passphrase required. Use --encryption or set DBDOCTOR_BACKUP_PASSPHRASE")
		}
	}

	fmt.Printf("💾 创建%s备份 (带重试机制)...\n", backupType)
	fmt.Printf("目标: s3://%s/%s\n", cfg.S3.Bucket, backupPrefix)
	fmt.Printf("集群: %s\n", cfg.DefaultCluster)
	if backupMaxRetries > 0 {
		fmt.Printf("最大重试次数: %d\n", backupMaxRetries)
	}
	fmt.Println()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		fmt.Println("\n🛑 收到中断信号，正在取消备份...")
		cancel()
	}()

	lastProgress := -1.0
	progressCallback := func(attempt int, status string, progress float64) {
		if int(progress) != int(lastProgress) {
			lastProgress = progress
			barWidth := 30
			filled := int(progress / 100 * float64(barWidth))
			bar := ""
			for i := 0; i < barWidth; i++ {
				if i < filled {
					bar += "█"
				} else {
					bar += "░"
				}
			}
			fmt.Printf("\r[尝试 %d] %s |%s| %.1f%%", attempt, status, bar, progress)
		}
	}

	retryConfig := cockroach.DefaultRetryConfig()
	if backupMaxRetries > 0 {
		retryConfig.MaxRetries = backupMaxRetries
	}

	opts := cockroach.BackupWithRetryOptions{
		S3Path:             s3Path,
		IncrementalFrom:    backupIncrementalFrom,
		EncryptionPassphrase: encryptionPass,
		FullBackup:         backupFull,
		RetryConfig:        retryConfig,
		ProgressCallback:   progressCallback,
		ResumeJobID:        backupResumeJobID,
	}

	fmt.Println()
	result, err := sqlClient.CreateBackupWithRetry(ctx, opts)
	fmt.Println()

	if err != nil {
		return fmt.Errorf("backup failed: %w", err)
	}

	fmt.Println("\n=== 备份完成 ===")
	fmt.Printf("✅ 备份任务成功\n")
	fmt.Printf("   Job ID: %d\n", result.JobID)
	fmt.Printf("   类型: %s\n", result.BackupType)
	fmt.Printf("   状态: %s\n", result.Status)
	fmt.Printf("   开始时间: %s\n", result.StartTime.Format(time.RFC3339))
	if !result.EndTime.IsZero() {
		fmt.Printf("   结束时间: %s\n", result.EndTime.Format(time.RFC3339))
		duration := result.EndTime.Sub(result.StartTime)
		fmt.Printf("   耗时: %v\n", duration)
	}
	fmt.Printf("   路径: %s\n", result.BackupPath)
	if result.SizeBytes > 0 {
		fmt.Printf("   大小: %.2f MB\n", float64(result.SizeBytes)/1024/1024)
	}
	if result.Rows > 0 {
		fmt.Printf("   行数: %d\n", result.Rows)
	}

	if jsonOutput {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
	}

	return nil
}

func listBackups(sqlClient *cockroach.SQLClient, s3Path string) error {
	encryptionPass := backupEncryption
	if encryptionPass == "" {
		encryptionPass = os.Getenv("DBDOCTOR_BACKUP_PASSPHRASE")
	}

	backups, err := sqlClient.ListBackups(s3Path, encryptionPass)
	if err != nil {
		return fmt.Errorf("failed to list backups: %w", err)
	}

	if jsonOutput {
		data, _ := json.MarshalIndent(backups, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("=== 可用备份列表 ===")
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "路径\t类型\t开始时间\t结束时间")

	for _, b := range backups {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n",
			b.BackupPath,
			b.BackupType,
			b.StartTime.Format(time.RFC3339),
			b.EndTime.Format(time.RFC3339),
		)
	}
	w.Flush()

	return nil
}

func checkBackupJob(sqlClient *cockroach.SQLClient, jobID int64) error {
	backupInfo, err := sqlClient.GetBackupJobStatus(jobID)
	if err != nil {
		return fmt.Errorf("failed to get backup job status: %w", err)
	}

	if jsonOutput {
		data, _ := json.MarshalIndent(backupInfo, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	fmt.Println("=== 备份任务状态 ===")
	fmt.Printf("Job ID: %d\n", backupInfo.JobID)
	fmt.Printf("状态: %s\n", backupInfo.Status)
	fmt.Printf("开始时间: %s\n", backupInfo.StartTime.Format(time.RFC3339))
	if !backupInfo.EndTime.IsZero() {
		fmt.Printf("结束时间: %s\n", backupInfo.EndTime.Format(time.RFC3339))
		duration := backupInfo.EndTime.Sub(backupInfo.StartTime)
		fmt.Printf("耗时: %v\n", duration)
	}
	if backupInfo.SizeBytes > 0 {
		fmt.Printf("大小: %.2f MB\n", float64(backupInfo.SizeBytes)/1024/1024)
	}
	if backupInfo.Rows > 0 {
		fmt.Printf("行数: %d\n", backupInfo.Rows)
	}

	return nil
}

func restoreBackup(sqlClient *cockroach.SQLClient, s3Path string, cfg *config.AppConfig) error {
	if backupDatabase == "" {
		return fmt.Errorf("target database name required for restore (--database)")
	}

	encryptionPass := backupEncryption
	if encryptionPass == "" {
		encryptionPass = os.Getenv("DBDOCTOR_BACKUP_PASSPHRASE")
		if encryptionPass == "" {
			return fmt.Errorf("backup encryption passphrase required. Use --encryption or set DBDOCTOR_BACKUP_PASSPHRASE")
		}
	}

	fmt.Printf("🔄 开始恢复...\n")
	fmt.Printf("目标数据库: %s\n", backupDatabase)
	fmt.Printf("备份来源: s3://%s/%s\n", cfg.S3.Bucket, backupPrefix)
	if backupTargetTime != "" {
		fmt.Printf("时间点: %s\n", backupTargetTime)
	}
	fmt.Println()

	jobID, err := sqlClient.RestoreBackup(s3Path, backupTargetTime, encryptionPass, backupDatabase)
	if err != nil {
		return fmt.Errorf("failed to start restore: %w", err)
	}

	fmt.Printf("✅ 恢复任务已创建\n")
	fmt.Printf("   Job ID: %d\n", jobID)
	fmt.Println("\nℹ️  使用 --job-id <id> 查看任务进度")

	return nil
}

func validateS3Config(s3Cfg *config.S3Config) error {
	sess, err := session.NewSession(&aws.Config{
		Region:      aws.String(s3Cfg.Region),
		Credentials: credentials.NewStaticCredentials(s3Cfg.AccessKey, s3Cfg.SecretKey, ""),
		Endpoint:    aws.String(s3Cfg.Endpoint),
		S3ForcePathStyle: aws.Bool(s3Cfg.PathStyle),
	})
	if err != nil {
		return fmt.Errorf("failed to create AWS session: %w", err)
	}

	client := s3.New(sess)
	_, err = client.HeadBucket(&s3.HeadBucketInput{
		Bucket: aws.String(s3Cfg.Bucket),
	})
	if err != nil {
		return fmt.Errorf("cannot access S3 bucket: %w", err)
	}

	return nil
}

func init() {
	backupCmd.Flags().BoolVar(&backupFull, "full", false, "create full backup")
	backupCmd.Flags().BoolVar(&backupIncremental, "incremental", true, "create incremental backup (default)")
	backupCmd.Flags().StringVar(&backupIncrementalFrom, "incremental-from", "", "base backup path for incremental")
	backupCmd.Flags().StringVarP(&backupEncryption, "encryption", "e", "", "encryption passphrase")
	backupCmd.Flags().StringVar(&backupTargetTime, "target-time", "", "target time for point-in-time restore (e.g., '2024-01-01 12:00:00')")
	backupCmd.Flags().StringVarP(&backupDatabase, "database", "d", "", "target database name for restore")
	backupCmd.Flags().BoolVarP(&backupList, "list", "l", false, "list available backups")
	backupCmd.Flags().BoolVarP(&backupRestore, "restore", "r", false, "restore from backup")
	backupCmd.Flags().Int64Var(&backupJobID, "job-id", 0, "check backup/restore job status")
	backupCmd.Flags().StringVar(&backupPrefix, "prefix", "cockroach-backups", "S3 key prefix for backups")
	backupCmd.Flags().BoolVar(&backupWithRetry, "with-retry", false, "enable retry mechanism for S3 network issues")
	backupCmd.Flags().IntVar(&backupMaxRetries, "max-retries", 5, "maximum number of retries")
	backupCmd.Flags().BoolVarP(&backupWait, "wait", "w", false, "wait for backup to complete with progress bar")
	backupCmd.Flags().Int64Var(&backupResumeJobID, "resume", 0, "resume previous backup job ID")

	backupCmd.MarkFlagsMutuallyExclusive("full", "incremental")
	rootCmd.AddCommand(backupCmd)
}
