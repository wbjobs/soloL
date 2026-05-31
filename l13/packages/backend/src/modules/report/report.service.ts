import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProofreadEvent, ProofreadEventDocument } from '../../common/schemas/proofread-event.schema';
import { Version, VersionDocument } from '../../common/schemas/version.schema';
import { ProofreadBlock, ProofreadBlockDocument } from '../../common/schemas/proofread-block.schema';
import { Project, ProjectDocument } from '../../common/schemas/project.schema';
import { AISuggestion, AISuggestionDocument } from '../../common/schemas/ai-suggestion.schema';

export interface PerUserStats {
  userId: string;
  editCount: number;
  aiAdoptCount: number;
  aiRejectCount: number;
  conflictResolutions: number;
  timelineAdjustments: number;
}

export interface ReportTotals {
  totalEdits: number;
  totalAiAdopts: number;
  totalAiRejects: number;
  totalConflicts: number;
  totalTimelineAdjusts: number;
  aiAdoptionRate: number;
  blocksCompleted: number;
  blocksTotal: number;
}

export interface AiSuggestionSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
}

export interface ReportStats {
  perUser: PerUserStats[];
  totals: ReportTotals;
  aiSuggestionSummary: AiSuggestionSummary;
  projectInfo: {
    name: string;
    createdAt: Date;
    blockCount: number;
    duration: number;
  };
}

@Injectable()
export class ReportService {
  constructor(
    @InjectModel(ProofreadEvent.name) private eventModel: Model<ProofreadEventDocument>,
    @InjectModel(Version.name) private versionModel: Model<VersionDocument>,
    @InjectModel(ProofreadBlock.name) private blockModel: Model<ProofreadBlockDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(AISuggestion.name) private suggestionModel: Model<AISuggestionDocument>,
  ) {}

  async getProjectStats(projectId: string): Promise<ReportStats> {
    const project = await this.projectModel.findById(projectId).exec();
    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    const perUserAggregation = await this.eventModel.aggregate<PerUserStats>([
      { $match: { projectId: project._id } },
      {
        $group: {
          _id: '$userId',
          editCount: {
            $sum: { $cond: [{ $eq: ['$eventType', 'edit'] }, 1, 0] },
          },
          aiAdoptCount: {
            $sum: { $cond: [{ $eq: ['$eventType', 'adopt-ai'] }, 1, 0] },
          },
          aiRejectCount: {
            $sum: { $cond: [{ $eq: ['$eventType', 'reject-ai'] }, 1, 0] },
          },
          conflictResolutions: {
            $sum: { $cond: [{ $eq: ['$eventType', 'conflict-resolve'] }, 1, 0] },
          },
          timelineAdjustments: {
            $sum: { $cond: [{ $eq: ['$eventType', 'timeline-adjust'] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          userId: '$_id',
          editCount: 1,
          aiAdoptCount: 1,
          aiRejectCount: 1,
          conflictResolutions: 1,
          timelineAdjustments: 1,
          _id: 0,
        },
      },
    ]);

    const perUser: PerUserStats[] = perUserAggregation || [];

    const [totalsData] = await this.eventModel.aggregate<{
      totalEdits: number;
      totalAiAdopts: number;
      totalAiRejects: number;
      totalConflicts: number;
      totalTimelineAdjusts: number;
    }>([
      { $match: { projectId: project._id } },
      {
        $group: {
          _id: null,
          totalEdits: {
            $sum: { $cond: [{ $eq: ['$eventType', 'edit'] }, 1, 0] },
          },
          totalAiAdopts: {
            $sum: { $cond: [{ $eq: ['$eventType', 'adopt-ai'] }, 1, 0] },
          },
          totalAiRejects: {
            $sum: { $cond: [{ $eq: ['$eventType', 'reject-ai'] }, 1, 0] },
          },
          totalConflicts: {
            $sum: { $cond: [{ $eq: ['$eventType', 'conflict-resolve'] }, 1, 0] },
          },
          totalTimelineAdjusts: {
            $sum: { $cond: [{ $eq: ['$eventType', 'timeline-adjust'] }, 1, 0] },
          },
        },
      },
    ]);

    const blockStats = await this.blockModel.aggregate<{
      blocksCompleted: number;
      blocksTotal: number;
    }>([
      { $match: { projectId: project._id } },
      {
        $group: {
          _id: null,
          blocksTotal: { $sum: 1 },
          blocksCompleted: {
            $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] },
          },
        },
      },
    ]);

    const totals: ReportTotals = {
      totalEdits: totalsData?.totalEdits || 0,
      totalAiAdopts: totalsData?.totalAiAdopts || 0,
      totalAiRejects: totalsData?.totalAiRejects || 0,
      totalConflicts: totalsData?.totalConflicts || 0,
      totalTimelineAdjusts: totalsData?.totalTimelineAdjusts || 0,
      aiAdoptionRate:
        totalsData && totalsData.totalAiAdopts + totalsData.totalAiRejects > 0
          ? totalsData.totalAiAdopts / (totalsData.totalAiAdopts + totalsData.totalAiRejects)
          : 0,
      blocksCompleted: blockStats[0]?.blocksCompleted || 0,
      blocksTotal: blockStats[0]?.blocksTotal || 0,
    };

    const [suggestionData] = await this.suggestionModel.aggregate<{
      total: number;
      accepted: number;
      rejected: number;
      pending: number;
    }>([
      { $match: { projectId: project._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          accepted: {
            $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
        },
      },
    ]);

    const aiSuggestionSummary: AiSuggestionSummary = {
      total: suggestionData?.total || 0,
      accepted: suggestionData?.accepted || 0,
      rejected: suggestionData?.rejected || 0,
      pending: suggestionData?.pending || 0,
    };

    const blocks = await this.blockModel
      .find({ projectId })
      .sort({ index: 1 })
      .exec();
    const duration =
      blocks.length > 0
        ? blocks[blocks.length - 1].endTime - blocks[0].startTime
        : 0;

    return {
      perUser,
      totals,
      aiSuggestionSummary,
      projectInfo: {
        name: project.name,
        createdAt: (project as any).createdAt,
        blockCount: project.blockCount,
        duration,
      },
    };
  }

  async generatePdfReport(projectId: string): Promise<Buffer> {
    const stats = await this.getProjectStats(projectId);

    const perUserRows = stats.perUser
      .map(
        (u) => `
        <tr>
          <td>${u.userId}</td>
          <td>${u.editCount}</td>
          <td>${u.aiAdoptCount}</td>
          <td>${u.conflictResolutions}</td>
          <td>${u.timelineAdjustments}</td>
        </tr>`,
      )
      .join('');

    const versions = await this.versionModel
      .find({ projectId })
      .sort({ versionNumber: -1 })
      .limit(10)
      .exec();

    const versionRows = versions
      .map(
        (v) => `
        <tr>
          <td>v${v.versionNumber}</td>
          <td>${v.createdBy || 'N/A'}</td>
          <td>${(v as any).createdAt ? new Date((v as any).createdAt).toLocaleString() : 'N/A'}</td>
        </tr>`,
      )
      .join('');

    const adoptionPct = (stats.totals.aiAdoptionRate * 100).toFixed(1);
    const completionPct =
      stats.totals.blocksTotal > 0
        ? ((stats.totals.blocksCompleted / stats.totals.blocksTotal) * 100).toFixed(1)
        : '0.0';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proofreading Report - ${stats.projectInfo.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #f8f9fa; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 2px solid #4361ee; }
    .header h1 { font-size: 28px; color: #1a1a2e; margin-bottom: 8px; }
    .header .meta { font-size: 14px; color: #6c757d; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px; }
    .card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .card .value { font-size: 32px; font-weight: 700; color: #4361ee; }
    .card .label { font-size: 12px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .section { margin-bottom: 36px; }
    .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #e9ecef; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th { background: #4361ee; color: #fff; padding: 12px 16px; text-align: left; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 10px 16px; border-bottom: 1px solid #e9ecef; font-size: 14px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8f9fa; }
    .ai-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 40px; }
    .ai-card { background: #fff; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    .ai-card .value { font-size: 28px; font-weight: 700; }
    .ai-card .label { font-size: 12px; color: #6c757d; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .ai-card.total .value { color: #4361ee; }
    .ai-card.accepted .value { color: #2ec4b6; }
    .ai-card.rejected .value { color: #e63946; }
    .ai-card.pending .value { color: #f4a261; }
    @media print { body { padding: 20px; } .cards, .ai-stats { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${stats.projectInfo.name}</h1>
      <div class="meta">
        Created: ${new Date(stats.projectInfo.createdAt).toLocaleDateString()} |
        Blocks: ${stats.projectInfo.blockCount} |
        Duration: ${this.formatDuration(stats.projectInfo.duration)} |
        Completion: ${completionPct}%
      </div>
    </div>

    <div class="cards">
      <div class="card">
        <div class="value">${stats.totals.totalEdits}</div>
        <div class="label">Total Edits</div>
      </div>
      <div class="card">
        <div class="value">${stats.totals.totalAiAdopts}</div>
        <div class="label">AI Adopts</div>
      </div>
      <div class="card">
        <div class="value">${stats.totals.totalConflicts}</div>
        <div class="label">Conflicts</div>
      </div>
      <div class="card">
        <div class="value">${adoptionPct}%</div>
        <div class="label">AI Adoption Rate</div>
      </div>
    </div>

    <div class="section">
      <h2>Per-User Statistics</h2>
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Edits</th>
            <th>AI Adopts</th>
            <th>Conflicts</th>
            <th>Timeline Adj.</th>
          </tr>
        </thead>
        <tbody>
          ${perUserRows || '<tr><td colspan="5" style="text-align:center;color:#6c757d;">No user data</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>AI Suggestion Analysis</h2>
      <div class="ai-stats">
        <div class="ai-card total">
          <div class="value">${stats.aiSuggestionSummary.total}</div>
          <div class="label">Total</div>
        </div>
        <div class="ai-card accepted">
          <div class="value">${stats.aiSuggestionSummary.accepted}</div>
          <div class="label">Accepted</div>
        </div>
        <div class="ai-card rejected">
          <div class="value">${stats.aiSuggestionSummary.rejected}</div>
          <div class="label">Rejected</div>
        </div>
        <div class="ai-card pending">
          <div class="value">${stats.aiSuggestionSummary.pending}</div>
          <div class="label">Pending</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>Version History</h2>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Author</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${versionRows || '<tr><td colspan="3" style="text-align:center;color:#6c757d;">No versions</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

    return Buffer.from(html, 'utf-8');
  }

  private formatDuration(ms: number): string {
    if (ms <= 0) return '0:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}
