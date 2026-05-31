import torch
import torch.nn as nn
import torch.nn.functional as F

from app.ml.pointnet2.modules import PointNetSetAbstraction, PointNetFeaturePropagation


class PointNet2(nn.Module):
    def __init__(self, num_classes: int = 10, in_channels: int = 3, use_pointnet: bool = False) -> None:
        super().__init__()
        self.num_classes = num_classes
        self.use_pointnet = use_pointnet

        if use_pointnet:
            self._build_pointnet(in_channels, num_classes)
        else:
            self._build_pointnet2(in_channels, num_classes)

    def _build_pointnet(self, in_channels: int, num_classes: int) -> None:
        self.conv1 = nn.Conv1d(in_channels, 64, 1)
        self.conv2 = nn.Conv1d(64, 128, 1)
        self.conv3 = nn.Conv1d(128, 256, 1)
        self.conv4 = nn.Conv1d(256, 512, 1)
        self.bn1 = nn.BatchNorm1d(64)
        self.bn2 = nn.BatchNorm1d(128)
        self.bn3 = nn.BatchNorm1d(256)
        self.bn4 = nn.BatchNorm1d(512)

        self.fc1 = nn.Linear(512, 256)
        self.fc2 = nn.Linear(256, 128)
        self.fc3 = nn.Linear(128, num_classes)
        self.dropout = nn.Dropout(0.4)
        self.bn_fc1 = nn.BatchNorm1d(256)
        self.bn_fc2 = nn.BatchNorm1d(128)

    def _build_pointnet2(self, in_channels: int, num_classes: int) -> None:
        additional_channels = in_channels - 3 if in_channels > 3 else 0

        self.sa1 = PointNetSetAbstraction(
            npoint=1024, radius=0.1, nsample=32,
            in_channel=3 + additional_channels,
            mlp=[32, 32, 64], group_all=False
        )
        self.sa2 = PointNetSetAbstraction(
            npoint=256, radius=0.2, nsample=32,
            in_channel=64 + 3,
            mlp=[64, 64, 128], group_all=False
        )
        self.sa3 = PointNetSetAbstraction(
            npoint=64, radius=0.4, nsample=32,
            in_channel=128 + 3,
            mlp=[128, 128, 256], group_all=False
        )
        self.sa4 = PointNetSetAbstraction(
            npoint=16, radius=0.8, nsample=32,
            in_channel=256 + 3,
            mlp=[256, 256, 512], group_all=False
        )

        self.fp4 = PointNetFeaturePropagation(in_channel=512 + 256, mlp=[256, 256])
        self.fp3 = PointNetFeaturePropagation(in_channel=256 + 128, mlp=[256, 128])
        self.fp2 = PointNetFeaturePropagation(in_channel=128 + 64, mlp=[128, 128, 128])
        self.fp1 = PointNetFeaturePropagation(in_channel=128 + additional_channels, mlp=[128, 128, 128])

        self.conv1 = nn.Conv1d(128, 128, 1)
        self.bn1 = nn.BatchNorm1d(128)
        self.dropout = nn.Dropout(0.5)
        self.conv2 = nn.Conv1d(128, num_classes, 1)

    def forward(self, xyz: torch.Tensor, features: torch.Tensor | None = None) -> torch.Tensor:
        if self.use_pointnet:
            return self._forward_pointnet(xyz, features)
        return self._forward_pointnet2(xyz, features)

    def _forward_pointnet(self, xyz: torch.Tensor, features: torch.Tensor | None) -> torch.Tensor:
        if features is None:
            x = xyz
        else:
            x = features

        x = F.relu(self.bn1(self.conv1(x)))
        x = F.relu(self.bn2(self.conv2(x)))
        x = F.relu(self.bn3(self.conv3(x)))
        x = F.relu(self.bn4(self.conv4(x)))

        x = torch.max(x, 2, keepdim=True)[0]
        x = x.view(-1, 512)

        x = F.relu(self.bn_fc1(self.dropout(self.fc1(x))))
        x = F.relu(self.bn_fc2(self.dropout(self.fc2(x))))
        x = self.fc3(x)

        num_points = xyz.shape[2]
        x = x.unsqueeze(-1).repeat(1, 1, num_points)
        return x

    def _forward_pointnet2(self, xyz: torch.Tensor, features: torch.Tensor | None) -> torch.Tensor:
        l0_xyz = xyz
        l0_points = features

        l1_xyz, l1_points = self.sa1(l0_xyz, l0_points)
        l2_xyz, l2_points = self.sa2(l1_xyz, l1_points)
        l3_xyz, l3_points = self.sa3(l2_xyz, l2_points)
        l4_xyz, l4_points = self.sa4(l3_xyz, l3_points)

        l3_points = self.fp4(l3_xyz, l4_xyz, l3_points, l4_points)
        l2_points = self.fp3(l2_xyz, l3_xyz, l2_points, l3_points)
        l1_points = self.fp2(l1_xyz, l2_xyz, l1_points, l2_points)
        l0_points = self.fp1(l0_xyz, l1_xyz, l0_points, l1_points)

        x = self.dropout(F.relu(self.bn1(self.conv1(l0_points))))
        x = self.conv2(x)

        return x
