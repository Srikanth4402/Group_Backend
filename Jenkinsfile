 pipeline {
  agent any
  environment {
    REGISTRY_CRED = 'dockerhub-creds'
    REGISTRY_IMAGE = 'yourdockerhubuser/node-auth-api'
    // Short SHA tag + 'latest'
    IMAGE_TAG = "${env.GIT_COMMIT.take(7)}"
  }
  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }
    stage('Build Docker image') {
      steps {
        script {
          sh """
            docker build -t ${REGISTRY_IMAGE}:${IMAGE_TAG} -t ${REGISTRY_IMAGE}:latest .
            """

        }
      }
    }
    stage('Login & Push') {
      steps {
        withCredentials([usernamePassword(credentialsId: env.REGISTRY_CRED,
                                          usernameVariable: 'DOCKER_USER',
                                          passwordVariable: 'DOCKER_PASS')]) {
          sh """
stdin
            echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password
            docker push ${REGISTRY_IMAGE}:${IMAGE_TAG}
            docker push ${REGISTRY_IMAGE}:latest
            docker logout
          """
        }
      }
    }
    stage('Deploy on EC2') {
      steps {
        // We deploy on the same host Jenkins runs on.
        // If Jenkins runs elsewhere, replace with SSH steps to your target.
        sh """
          cd /opt/node-auth
          REGISTRY_IMAGE=${REGISTRY_IMAGE} TAG=${IMAGE_TAG} docker compose pull
          REGISTRY_IMAGE=${REGISTRY_IMAGE} TAG=${IMAGE_TAG} docker compose up -d
          docker image prune -f
        """
      }
    }
  }
  post {
    always {
      cleanWs()
    }
  }
 }