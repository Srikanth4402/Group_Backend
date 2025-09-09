pipeline {
    agent any

    environment {
        DOCKERHUB_USER = credentials('dockerhub-creds') // Jenkins credentials ID for DockerHub
        EC2_USER = 'ubuntu'
        EC2_HOST = 'your-ec2-public-ip'
        EC2_KEY = credentials('ec2-ssh-key') // SSH private key stored in Jenkins
        APP_NAME = 'node-auth-api'
        REPO = 'yourdockerhubuser/node-auth-api'
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main',
                    credentialsId: 'group-project-backend',
                    url: 'https://github.com/Srikanth4402/Group_Backend.git'
            }
        }

        stage('Build Docker image') {
            steps {
                script {
                    def shortCommit = sh(returnStdout: true, script: 'git rev-parse --short HEAD').trim()
                    sh """
                        docker build -t ${REPO}:${shortCommit} -t ${REPO}:latest .
                    """
                }
            }
        }

        stage('Login & Push') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'dockerhub-creds',
                                                 usernameVariable: 'DOCKER_USER',
                                                 passwordVariable: 'DOCKER_PASS')]) {
                    sh """
                        echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                        docker push ${REPO}:latest
                    """
                }
            }
        }

        stage('Deploy on EC2') {
            steps {
                sshagent(['ec2-ssh-key']) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${EC2_USER}@${EC2_HOST} "
                            docker pull ${REPO}:latest &&
                            docker stop ${APP_NAME} || true &&
                            docker rm ${APP_NAME} || true &&
                            docker run -d --name ${APP_NAME} -p 3000:3000 ${REPO}:latest
                        "
                    """
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
    }
}
