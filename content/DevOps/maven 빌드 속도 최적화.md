---
title: "[Maven] 빌드 속도 최적화"
date: 2024-12-12
draft: false
tags:
  - maven
banner: 
cssclasses: 
description: 
permalink: 
aliases: 
completed:
---

## 📝 요약
> [!summary]
> mvn clean install -T 1C -Dmaven.javadoc.skip=true -Dmaven.test.skip=true -f pom.xml

## ⚙️ 환경
- Java : 1.8

## 💬 이슈
프로젝트를 로컬에서 테스트 할 때 마다 generated-sources 변경이나 협업자들의 추가 개발 사항에 맞춰서 빌드를 자주 하게 되는데, 테스트를 스킵해도 매번 2분 이상의 빌드시간이 발생하는 것이 여간 불편하게 느껴지지 않을 수 없었다.  

## 🧗 해결
### 적용한 것
- CPU 변경 : AMD 4350g (2m) - Apple M1 (1m) - Apple M4 (47s)
- `-Dmaven.test.skip=true` : 테스트 컴파일 및 실행 건너뛰기 (47s)
- `-T 1C` : 코어당 하나의 스레드 사용 (33s)
- `-Dmaven.javadoc.skip=true` : javadoc 생성 건너뛰기 (32s)  

코딩도 역시 장비빨인가.. 프로세서를 바꾸면서 빌드타임이 획기적으로 단축됐다. 물론 PC 자체가 바뀐거라 프로세서 외에 메모리나 저장장치 쪽 개선도 있겠지만 아무튼.. ~~애플 실리콘 맥 최고..!~~ 

### 적용 불가
- 컴파일러 버전 최신화 : 프로젝트 라이브러리 중 lombok 이 컴파일러 버전과 호환되지 않아 테스트가 불가했음  

이밖에도 필요한 모듈만 따로컴파일하거나 generate-sources 만 따로 생성하는 등 여러 전략들이 있던데, 1)사실 이정도의 시간 단축이면 충분하기도 했고 2)매번 변경사항을 파악하고 다른 빌드 방식을 선택하는 것 또한 비용이자 스트레스라 생각해 나중에 시간나면 더 알아보는 걸로 하고 여기까지만 파악함!   


## 🚀 참고
- [https://rainbound.tistory.com/entry/maven-%EB%B9%8C%EB%93%9C-%EC%86%8D%EB%8F%84-%EA%B0%9C%EC%84%A0](https://rainbound.tistory.com/entry/maven-%EB%B9%8C%EB%93%9C-%EC%86%8D%EB%8F%84-%EA%B0%9C%EC%84%A0)
- [https://insertintoblog.tistory.com/25](https://insertintoblog.tistory.com/25)
