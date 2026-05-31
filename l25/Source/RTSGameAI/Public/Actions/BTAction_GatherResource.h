#pragma once
#include "BT/BTAction.h"

class BTAction_GatherResource : public BTAction {
public:
    BTAction_GatherResource();
    void SetResourceType(int Type) { TargetResourceType = Type; }
protected:
    BTStatus Execute(float DeltaTime) override;
private:
    float GatherTimer = 0.f;
    float GatherInterval = 2.f;
    int GatherAmount = 10;
    int TargetResourceType = 0;
    int CurrentTargetNodeId = -1;
    int ConsecutiveEmptyTicks = 0;
    static constexpr int MaxEmptyTicks = 3;
};
