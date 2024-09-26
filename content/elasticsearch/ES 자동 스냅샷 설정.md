---
title: ES 자동 스냅샷 설정
date: 2023-02-08
draft: false
tags:
  - elasticsearch
banner: 
cssclasses: 
description: 엘라스틱 서치 스냅샷 설정 방법을 알아 보았습니다.
permalink: 
aliases: 
completed:
---
## 이슈

데이터 보호를 위해서 일정 주기로 엘라스틱서치 데이터를 스냅샷으로 보관해둘 필요성이 생겼다. 확인해보니 SLM(snapshot lifecycle management) API 를 사용하면 자동으로 스냅샷을 기록할 수 있다고 한다.

  

## 해결

- Elasticsearch 8.4.3 버전 기준

  

우선 엘라스틱 실행 시 `ELASTICSEARCH_FS_SNAPSHOT_REPO_PATH` 환경변수에 스냅샷 경로를 지정해주어야한다. 그렇지않으면

> **Doesn’t match any of the locations specified by path.repo because this setting is empty**

와 같은 오류가 발생한다. bitnami helm 차트의 경우 values.yaml 파일에 `snapshotRepoPath` 값을 수정해주면 되고 그 외의 경우에는 ENV 등으로 변수 설정이 필요하다.

  

```yaml
# bitnami 차트는 이 키값을 변경한다.
snapshotRepoPath: "<스냅샷 데이터를 저장할 PV마운트 경로>"
```

  

환경변수를 설정했으면 엘라스틱서치를 다시 실행해준다. 그리고 아래 요청을 cURL 이나 kibana 를 통해서 입력해주면 된다.

  

```bash
# 리포지토리 등록
PUT _snapshot/backup
{
  "type": "fs",
  "settings": {
    "location": "<스냅샷 데이터를 저장할 PV마운트 경로>"
  }
}

# 리포 등록 확인
GET _snapshot/backup?pretty

# 검증
POST _snapshot/backup/_verify?pretty

# SLM security privileges 등록
POST _security/role/slm-admin
{
  "cluster": [ "manage_slm", "cluster:admin/snapshot/*" ],
  "indices": [
    {
      "names": [ ".slm-history-*" ],
      "privileges": [ "all" ]
    }
  ]
}

# SLM 규칙 생성 (UTC 기준 매일 18시에 스냅샷 진행)
PUT _slm/policy/cron-snapshots
{
  "schedule": "0 0 18 * * ?",       
  "name": "<cron-snap-{now/d}>", 
  "repository": "backup",    
  "config": {
    "indices": "*",                 
    "include_global_state": true    
  },
  "retention": {                    
    "expire_after": "30d",
    "min_count": 5,
    "max_count": 50
  }
}

# 생성 확인
GET _slm/policy
```

  

의문스러운 점은 파드를 KST 로 설정했음에도 크론탭은 UTC 기준으로 동작하는 점인데, 나중에 시간이 나면 다시 확인해봐야겠다.

  

## 참고

- [https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-filesystem-repository.html](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-filesystem-repository.html)
- [https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-take-snapshot.html#automate-snapshots-slm](https://www.elastic.co/guide/en/elasticsearch/reference/current/snapshots-take-snapshot.html#automate-snapshots-slm)
- [https://semode.tistory.com/44](https://semode.tistory.com/44)