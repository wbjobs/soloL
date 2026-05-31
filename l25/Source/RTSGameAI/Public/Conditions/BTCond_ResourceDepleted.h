#pragma once
#include "BT/BTCondition.h"

class BTCond_ResourceDepleted : public BTCondition {
public:
    BTCond_ResourceDepleted();
    void SetResourceType(int Type) { TargetResourceType = Type; }
    void SetCheckAllResources(bool bAll) { bCheckAll = bAll; }
    bool IsResourceDepleted() const;
private:
    int TargetResourceType = 0;
    bool bCheckAll = false;
};
