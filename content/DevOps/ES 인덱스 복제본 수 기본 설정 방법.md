---
title: 인덱스 복제본 수 기본 설정
date: 2023-02-09
draft: false
tags:
  - elasticsearch
banner: 
cssclasses: 
description: 엘라스틱서치 index 를 생성할 때 replica 수를 자동으로 지정하는 방법을 알아보았습니다.
permalink: 
aliases: 
completed:
---
## 요약

> [!important]  
> 모든 인덱스를 대상으로 하는 템플릿을 생성한다.  

  

## 이슈

엘라스틱서치 인덱스를 생성할 때마다 복제본 수를 지정하기 위해서 `number_of_replicas` 를 지정해주는 것이 번거로워 일괄적으로 복제본 수 를 수정할 수 있는 방법을 알아보았다.

  

## 해결

아래와 같은 템플릿을 생성하면 이후에 생성되는 모든 인덱스는 2개의 복제본을 기본으로 가지게 된다.

  

```json
PUT _template/all 
{
	"index_patterns": "*",
	"order": 1,
	"settings": {
		"number_of_replicas": 2
	}
}
```

  

## 참고

- [https://stackoverflow.com/questions/63989012/how-to-chose-the-number-of-shards-and-replicas-elasticsearch](https://stackoverflow.com/questions/63989012/how-to-chose-the-number-of-shards-and-replicas-elasticsearch)