---
title: 메이븐 외부 라이브러리 추가 (systemPath)
date: 2022-11-22
draft: false
tags:
  - maven
  - springboot
banner: 
cssclasses: 
description: 메이븐 공식 리포지토리에 존재하지 않는 ‘*.jar’ 형식의 라이브러리를 프로젝트에 추가하는 방법을 알아본다.
permalink: 
aliases: 
completed:
---
메이븐 프로젝트를 빌드할 때 공식 repository 에 존재하지 않는 라이브러리를 추가해야하는 경우, 몇가지 방법 중 `systemPath` 를 고려해볼 수 있다.

  

### pom.xml 수정

dependencies 에 의존성 추가

```bash
<dependency>
	<groupId>groupId</groupId>
	<artifactId>artifactId</artifactId>
	<version>0.0.1</version>
	<scope>system</scope>
	<systemPath>${pom.basedir}/lib/filename.jar</systemPath>
</dependency>
```

  

runtime 에 NoClassDefFoundError 를 만나지 않기위해 plugins 에 다음 코드를 추가한다.

```bash
<plugin>
	<groupId>org.springframework.boot</groupId>
	<artifactId>spring-boot-maven-plugin</artifactId>
	...
	<configuration>
		...
		<includeSystemScope>true</includeSystemScope>
	</configuration>
	...
</plugin>
```